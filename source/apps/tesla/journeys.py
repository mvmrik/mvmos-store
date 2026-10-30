"""Read-only period analysis shared by saved journeys and automatic drives.

Saved journeys only store a name and UTC bounds. All observations remain in the
collector's original tables. Half-open bounds prevent counting boundary sessions
again. Partial sessions use observed points, never a time fraction of whole totals.
"""
import bisect
import math
import time


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _clip(points, start, end, fields, max_gap=300):
    points = sorted(points, key=lambda p: p['ts'])
    if not points:
        return []
    times = [p['ts'] for p in points]
    out = [dict(p) for p in points if start <= p['ts'] <= end]
    for boundary in (start, end):
        i = bisect.bisect_left(times, boundary)
        if 0 < i < len(points) and times[i] != boundary and times[i] - times[i - 1] <= max_gap:
            a, b = points[i - 1], points[i]
            ratio = (boundary - a['ts']) / (b['ts'] - a['ts'])
            p = {'ts': boundary}
            for key in fields:
                p[key] = a.get(key) + (b.get(key) - a.get(key)) * ratio if _num(a.get(key)) and _num(b.get(key)) else None
            out.append(p)
    return sorted({p['ts']: p for p in out}.values(), key=lambda p: p['ts'])


def _integrate(points, start, end):
    consumed = regen = 0.0
    known = False
    for a, b in zip(points, points[1:]):
        dt = b['ts'] - a['ts']
        lo, hi = max(start, a['ts']), min(end, b['ts'])
        if dt <= 0 or hi <= lo or not _num(a.get('power')) or not _num(b.get('power')):
            continue
        known = True
        p0 = a['power'] + (b['power'] - a['power']) * (lo - a['ts']) / dt
        p1 = a['power'] + (b['power'] - a['power']) * (hi - a['ts']) / dt
        hours = (hi - lo) / 3600 * min(dt, 180) / dt
        if p0 * p1 < 0:
            ratio = abs(p0) / (abs(p0) + abs(p1))
            pieces = [(p0 / 2 * hours * ratio), (p1 / 2 * hours * (1 - ratio))]
        else:
            pieces = [(p0 + p1) / 2 * hours]
        for energy in pieces:
            consumed += max(0, energy)
            regen += max(0, -energy)
    return (consumed, regen) if known else (None, None)


def _routes(points, max_points=1200):
    routes, current, previous = [], [], None
    for p in points:
        if not (_num(p.get('lat')) and _num(p.get('lng'))):
            if current:
                routes.append(current)
            current, previous = [], None
            continue
        if previous and p['ts'] - previous['ts'] > 600:
            if current:
                routes.append(current)
            current = []
        current.append([p['lat'], p['lng'], p.get('speed'), p['ts']])
        previous = p
    if current:
        routes.append(current)
    for route in routes:
        step = max(1, math.ceil(len(route) / max_points))
        reduced = route[::step]
        if reduced[-1] != route[-1]:
            reduced.append(route[-1])
        yield reduced


def _bounds(row, start, end, now):
    actual_end = now if row.get('open') else row.get('end_ts') or row['start_ts']
    lo, hi = max(start, row['start_ts']), min(end, actual_end)
    return lo, hi, row['start_ts'] < start or actual_end > end


def report(c, vid, start, end, trip_out, charge_out, only_trip=None, now=None):
    now = int(time.time()) if now is None else now
    end = min(end, now)
    end = max(start, end)
    result = {'start': start, 'end': end, 'now': now, 'trips': [], 'charges': [], 'routes': [], 'markers': [],
              'timeline': [], 'series': [], 'events': [], 'stats': {}, 'partial': False, 'playback': []}
    trips = c.execute('SELECT * FROM trips WHERE vehicle=? AND start_ts<? AND (CASE WHEN open=1 THEN ? ELSE COALESCE(end_ts,start_ts) END)>? ORDER BY start_ts', (vid, end, now, start)).fetchall() if end > start else []
    fallback_playback = {}
    for tr in trips:
        tr = dict(tr)
        if only_trip is not None and tr['id'] != only_trip:
            continue
        lo, hi, partial = _bounds(tr, start, end, now)
        if hi <= lo:
            continue
        points = [dict(p) for p in c.execute('SELECT ts,lat,lng,speed,power,battery FROM trip_points WHERE trip=? ORDER BY ts', (tr['id'],))]
        for point in points:
            if lo <= point['ts'] <= hi:
                fallback_playback[point['ts']] = [point['ts'],point['lat'],point['lng'],point['speed'],point['power'],point['battery'],'driving']
        clipped = _clip(points, lo, hi, ('lat', 'lng', 'speed', 'power', 'battery'))
        item = trip_out(tr)
        item.update({'start_ts': lo, 'end_ts': hi, 'duration': hi - lo, 'partial': partial})
        consumed, regen = _integrate(points, lo, hi)
        item['consumed_kwh'], item['regen_kwh'] = consumed, regen
        item['distance_complete'] = item['energy_complete'] = True
        if partial:
            odo = [dict(p) for p in c.execute('SELECT ts,odo_km FROM samples WHERE vehicle=? AND ts>=? AND ts<=? AND odo_km IS NOT NULL ORDER BY ts', (vid, tr['start_ts'], now if tr['open'] else tr['end_ts']))]
            odo = _clip(odo, lo, hi, ('odo_km',))
            item['distance_km'] = max(0, odo[-1]['odo_km'] - odo[0]['odo_km']) if len(odo) > 1 else None
            item['distance_complete'] = bool(len(odo) > 1 and odo[0]['ts'] == lo and odo[-1]['ts'] == hi)
            item['energy_complete'] = bool(clipped and clipped[0]['ts'] == lo and clipped[-1]['ts'] == hi and all(_num(p.get('power')) for p in clipped))
            item['energy_kwh'] = consumed - regen if consumed is not None else None
            # Original endpoint names may lie outside the selected period.
            for side, changed, point in (('start', lo > tr['start_ts'], clipped[0] if clipped else {}),
                                         ('end', hi < (now if tr['open'] else tr['end_ts']), clipped[-1] if clipped else {})):
                if changed:
                    item[side + '_place'] = item[side + '_addr'] = ''
                    item[side + '_lat'], item[side + '_lng'] = point.get('lat'), point.get('lng')
            item['start_batt'] = clipped[0].get('battery') if clipped else None
            item['end_batt'] = clipped[-1].get('battery') if clipped else None
            item['max_speed'] = max((p['speed'] for p in clipped if _num(p.get('speed'))), default=None)
        item['avg_speed'] = item['distance_km'] / ((hi - lo) / 3600) if item['distance_km'] is not None else None
        item['wh_km'] = item['energy_kwh'] * 1000 / item['distance_km'] if item['distance_km'] and item['energy_kwh'] is not None else None
        result['trips'].append(item)
        for route in _routes(clipped):
            result['routes'].append({'trip': tr['id'], 'points': route})
        result['events'].append({'kind': 'trip', 'id': tr['id'], 'start': lo, 'end': hi, 'partial': partial})
        result['partial'] |= partial

    if only_trip is None and end > start:
        charges = c.execute('SELECT * FROM charges WHERE vehicle=? AND start_ts<? AND (CASE WHEN open=1 THEN ? ELSE COALESCE(end_ts,start_ts) END)>? ORDER BY start_ts', (vid, end, now, start))
        for ch in charges:
            ch = dict(ch)
            lo, hi, partial = _bounds(ch, start, end, now)
            item = charge_out(ch)
            item.update({'start_ts': lo, 'end_ts': hi, 'duration': hi - lo, 'partial': partial, 'charged_complete': True})
            if partial:
                pts = [dict(p) for p in c.execute('SELECT ts,energy,battery,power FROM charge_points WHERE charge=? ORDER BY ts', (ch['id'],))]
                pts = _clip(pts, lo, hi, ('energy', 'battery', 'power'), 1800)
                energies = [p for p in pts if _num(p.get('energy'))]
                item['charged_complete'] = bool(len(energies)>1 and energies[0]['ts']==lo and energies[-1]['ts']==hi)
                item['kwh'] = sum(max(0, b['energy'] - a['energy']) for a, b in zip(energies, energies[1:])) if len(energies) > 1 else None
                item['cost'] = item['kwh'] * item['price'] if item['kwh'] is not None and item['price'] is not None else None
                item['start_batt'] = pts[0].get('battery') if pts else None
                item['end_batt'] = pts[-1].get('battery') if pts else None
                item['max_power'] = max((p['power'] for p in pts if _num(p.get('power'))), default=None)
            if 'cost_totals' in item:
                item = charge_out(item)
            result['charges'].append(item)
            if _num(ch.get('lat')) and _num(ch.get('lng')):
                result['markers'].append({'lat': ch['lat'], 'lng': ch['lng'], 'id': ch['id'], 'label': item.get('place') or item.get('addr') or ''})
            result['events'].append({'kind': 'charge', 'id': ch['id'], 'start': lo, 'end': hi, 'partial': partial})
            result['partial'] |= partial

    cursor = start
    state_totals = {}
    if end > start:
        for row in c.execute('SELECT * FROM states WHERE vehicle=? AND start_ts<? AND COALESCE(end_ts,?)>? ORDER BY start_ts', (vid, end, now, start)):
            lo, hi = max(cursor, start, row['start_ts']), min(end, row['end_ts'] or now)
            if hi <= lo:
                continue
            if lo > cursor:
                result['timeline'].append({'start': cursor, 'end': lo, 'state': 'unknown'})
            result['timeline'].append({'start': lo, 'end': hi, 'state': row['state']})
            cursor = hi
    if cursor < end:
        result['timeline'].append({'start': cursor, 'end': end, 'state': 'unknown'})
    for row in result['timeline']:
        state_totals[row['state']] = state_totals.get(row['state'], 0) + row['end'] - row['start']
        if only_trip is None and row['state'] not in ('driving', 'charging'):
            result['events'].append({'kind': 'state', **row})
    result['events'].sort(key=lambda e: (e['start'], e['kind']))

    fields = ('inside_temp', 'outside_temp', 'speed', 'power', 'tpms_fl', 'tpms_fr', 'tpms_rl', 'tpms_rr')
    readings = {k: {'min': None, 'max': None, 'sum': 0, 'count': 0} for k in fields}
    flags = {k: {'seconds': 0, 'observed_seconds': 0} for k in ('climate', 'sentry', 'battery_heater', 'user_present')}
    count, first, last, previous, bucket = 0, None, None, None, None
    bucket_size = max(1, (end - start) / 1200)
    for row in c.execute('SELECT * FROM samples WHERE vehicle=? AND ts>=? AND ts<=? ORDER BY ts,id', (vid, start, end)) if end > start else []:
        row = dict(row)
        frame = [row['ts'],row.get('lat'),row.get('lng'),row.get('speed'),row.get('power'),row.get('battery'),row.get('state'),row.get('charger_power')]
        if result['playback'] and result['playback'][-1][0] == row['ts']:
            result['playback'][-1] = frame
        else:
            result['playback'].append(frame)
        if first is None:
            first = row
        last = row
        count += 1
        for key in fields:
            v = row.get(key)
            if _num(v):
                r = readings[key]
                r['min'] = v if r['min'] is None else min(r['min'], v)
                r['max'] = v if r['max'] is None else max(r['max'], v)
                r['sum'] += v
                r['count'] += 1
        if previous:
            dt = row['ts'] - previous['ts']
            if 0 < dt <= 1800:
                for key in flags:
                    if previous.get(key) is not None:
                        flags[key]['observed_seconds'] += dt
                        if previous[key]:
                            flags[key]['seconds'] += dt
        point = [row['ts'], row.get('battery'), row.get('inside_temp'), row.get('outside_temp'), row.get('speed'), row.get('power')]
        new_bucket = int((row['ts'] - start) / bucket_size)
        if bucket != new_bucket or not result['series']:
            result['series'].append(point)
            bucket = new_bucket
        else:
            result['series'][-1] = point
        previous = row
    if first and (not result['series'] or result['series'][0][0] != first['ts']):
        result['series'].insert(0, [first['ts'], first.get('battery'), first.get('inside_temp'), first.get('outside_temp'), first.get('speed'), first.get('power')])
    if not result['playback']:
        result['playback'] = [fallback_playback[k] for k in sorted(fallback_playback)]
    def total(items, field):
        values = [r[field] for r in items if _num(r.get(field))]
        return sum(values) if values else None
    drives, charges = result['trips'], result['charges']
    distance, energy = total(drives, 'distance_km'), total(drives, 'energy_kwh')
    driving_seconds = sum(t['duration'] for t in drives)
    stats = {'distance_km': distance, 'energy_kwh': energy, 'consumed_kwh': total(drives, 'consumed_kwh'), 'regen_kwh': total(drives, 'regen_kwh'),
             'distance_complete': all(x['distance_complete'] and _num(x.get('distance_km')) for x in drives), 'energy_complete': all(x['energy_complete'] and _num(x.get('energy_kwh')) for x in drives),
             'charged_complete': all(x['charged_complete'] and _num(x.get('kwh')) for x in charges), 'charged_kwh': total(charges, 'kwh'), 'cost': total(charges, 'cost'), 'cost_complete': all(x['cost'] is not None for x in charges),
             'trips': len(drives), 'charges': len(charges), 'ac_charges': sum(not x['dc'] for x in charges), 'dc_charges': sum(bool(x['dc']) for x in charges),
             'driving_seconds': driving_seconds, 'charging_seconds': sum(x['duration'] for x in charges), 'elapsed_seconds': end - start,
             'avg_speed': distance / (driving_seconds / 3600) if driving_seconds and distance is not None else None,
             'max_speed': max((x['max_speed'] for x in drives if _num(x.get('max_speed'))), default=None),
             'wh_km': energy * 1000 / distance if distance and energy is not None else None,
             'readings': count, 'first_reading': first['ts'] if first else None, 'last_reading': last['ts'] if last else None,
             'start_battery': first.get('battery') if first else None, 'end_battery': last.get('battery') if last else None,
             'state_seconds': state_totals, 'flags': flags,
             'readings_stats': {k: {'min': v['min'], 'max': v['max'], 'avg': v['sum'] / v['count'] if v['count'] else None} for k, v in readings.items()}}
    currencies = {}
    for ch in charges:
        for total in ch.get('cost_totals', []):
            currencies[total['currency']] = currencies.get(total['currency'], 0) + total['cost']
    stats['cost_totals'] = [{'currency':k,'cost':round(v,2)} for k,v in currencies.items()]
    stats['cost_complete'] = all(ch.get('cost_complete',ch['cost'] is not None) for ch in charges)
    if currencies:
        stats['cost'] = next(iter(currencies.values())) if len(currencies)==1 and stats['cost_complete'] else None
    result['stats'] = stats
    return result
