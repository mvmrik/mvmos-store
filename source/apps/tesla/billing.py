"""Location tariffs and read-only charging cost allocation over recorded energy.

Money is kept per currency. No currency conversion or new vehicle polling occurs.
An interval crossing a price boundary is split by elapsed time between meter
readings and explicitly marked estimated. Original observations are never edited.
"""
import datetime as dt
import json
import math
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def amount(v):
    return float(Decimal(str(v)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def minute(value):
    h, m = map(int, value.split(':'))
    if not (0 <= h < 24 and 0 <= m < 60) or len(value) != 5:
        raise ValueError('invalid_tariff')
    return h * 60 + m


def season(rule, date):
    key = date.month * 100 + date.day
    a, b = rule['season_from'], rule['season_to']
    return a <= key <= b if a <= b else key >= a or key <= b


def matches(rule, local):
    m = local.hour * 60 + local.minute
    a, b = minute(rule['from']), minute(rule['to'])
    date = local.date()
    if a == b:
        pass
    elif a < b:
        if not a <= m < b: return False
    elif m >= a:
        pass
    elif m < b:
        date -= dt.timedelta(days=1)
    else:
        return False
    return date.weekday() in rule['days'] and season(rule, date)


def validate(body):
    name = str(body.get('name', '')).strip()
    start, end = body.get('start_ts'), body.get('end_ts')
    if not name or len(name) > 120 or not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= 7258118400:
        raise ValueError('invalid_tariff')
    currency = str(body.get('currency', '')).upper()
    if len(currency) != 3 or not currency.isascii() or not currency.isalpha(): raise ValueError('invalid_currency')
    zone = str(body.get('timezone', 'UTC'))
    try: ZoneInfo(zone)
    except Exception: raise ValueError('invalid_timezone')
    kind = body.get('kind', 'all')
    if kind not in ('all', 'ac', 'dc'): raise ValueError('invalid_tariff')
    rules = body.get('rules')
    if not isinstance(rules, list) or not 1 <= len(rules) <= 32: raise ValueError('invalid_tariff')
    cleaned, occupied = [], defaultdict(list)
    for raw in rules:
        label = str(raw.get('name', '')).strip()
        price = raw.get('price')
        days = raw.get('days', [])
        if not label or len(label) > 80 or not number(price) or not 0 <= price <= 100000 or not isinstance(days, list) or not days or any(type(x) is not int or not 0 <= x <= 6 for x in days):
            raise ValueError('invalid_tariff')
        a, b = minute(raw.get('from', '')), minute(raw.get('to', ''))
        sf, st = int(raw.get('season_from', 101)), int(raw.get('season_to', 1231))
        for key in (sf, st):
            try: dt.date(2024, key // 100, key % 100)
            except ValueError: raise ValueError('invalid_tariff')
        r = {'name':label, 'price':price, 'days':sorted(set(days)), 'from':raw['from'], 'to':raw['to'], 'season_from':sf, 'season_to':st}
        # Validate annual seasons and weekly windows together, including the
        # next-day portion of an overnight band. Monday is zero everywhere.
        for day in range(366):
            date = dt.date(2024, 1, 1) + dt.timedelta(days=day)
            if not season(r, date): continue
            for weekday in r['days']:
                chunks = [(date, weekday, a, b)] if a < b else [(date, weekday, 0, 1440)] if a == b else [(date, weekday, a, 1440), (date + dt.timedelta(days=1), (weekday+1)%7, 0, b)]
                for date2, wd, lo, hi in chunks:
                    if hi <= lo: continue
                    key = (date2.month, date2.day, wd)
                    if any(lo < old_hi and hi > old_lo for old_lo, old_hi in occupied[key]): raise ValueError('overlapping_rules')
                    occupied[key].append((lo, hi))
        cleaned.append(r)
    return {'name':name, 'place_id':str(body.get('place_id', '')), 'start_ts':start, 'end_ts':end, 'currency':currency, 'timezone':zone, 'kind':kind, 'rules':cleaned}


class Billing:
    def __init__(self, c, uid, prefs, places, near, currency='EUR'):
        self.c, self.uid, self.prefs, self.places, self.near, self.currency = c, uid, prefs, places, near, currency
        self.plans = []
        for row in c.execute('SELECT * FROM tariffs WHERE user_id=? ORDER BY start_ts', (uid,)):
            p = dict(row); p['rules'] = json.loads(p['rules']); p['zone'] = ZoneInfo(p['timezone']); self.plans.append(p)
        self.overrides = {r['charge']: dict(r) for r in c.execute('SELECT * FROM charge_costs WHERE user_id=?', (uid,))}

    def rate(self, ts, place, dc):
        applicable = [p for p in self.plans if place and p['place_id'] == place['id'] and p['kind'] in ('all', 'dc' if dc else 'ac')]
        for p in applicable:
            if p['start_ts'] <= ts < p['end_ts']:
                local = dt.datetime.fromtimestamp(ts, p['zone'])
                for rule in p['rules']:
                    if matches(rule, local): return (p['id'], rule['name'], p['currency'], rule['price'], 'tariff')
                return None
        if applicable: return None
        price = place['dc_price' if dc else 'ac_price'] if place else None
        if price is None: price = self.prefs.get('default_dc_price' if dc else 'default_ac_price')
        return ('', '', self.currency, price, 'legacy') if number(price) else None

    def decorate(self, row):
        out = dict(row)
        original = self.c.execute('SELECT * FROM charges WHERE id=? AND vehicle=?', (row['id'], row['vehicle'])).fetchone()
        if not original: return out
        original = dict(original)
        override = self.overrides.get(row['id']) or {}
        manual_place = next((p for p in self.places if p['id'] == override.get('place_id')), None)
        place = manual_place or self.near(self.places, original['lat'], original['lng'])
        out.update(place=place['name'] if place else '', place_id=place['id'] if place else None, manual_cost=override or None)
        start = original['start_ts']; end = original['end_ts'] or start
        lo, hi = max(start, row['start_ts']), min(end, row.get('end_ts') or end)
        total = original.get('kwh')
        full = lo <= start and hi >= end
        points = [(p['ts'], p['energy']) for p in self.c.execute('SELECT ts,energy FROM charge_points WHERE charge=? AND ts>=? AND ts<=? ORDER BY ts', (row['id'], start, end)) if number(p['energy'])]
        estimated = False
        weights = []
        if number(total) and total >= 0 and end > start:
            # Collector totals are authoritative. Interior cumulative readings
            # determine distribution, bounded by zero and that session total.
            pts = {t:max(0, min(total, e)) for t,e in points}
            pts[start], pts[end] = 0, total
            pts = sorted(pts.items())
            monotonic = all(b[1] >= a[1] for a,b in zip(pts,pts[1:]))
            if monotonic:
                weights = [(a[0], b[0], b[1]-a[1]) for a,b in zip(pts,pts[1:]) if b[0]>a[0] and b[1]>a[1]]
            else:
                estimated = True
            if not weights and total > 0:
                weights = [(start,end,total)]; estimated = True
            if len(points) < 2: estimated = True
        estimated = not full and (estimated or any(a < lo < b or a < hi < b for a,b,e in weights))
        selected_energy = sum(e * max(0, min(b,hi)-max(a,lo))/(b-a) for a,b,e in weights)
        if full and number(total): selected_energy = total
        elif not weights: selected_energy = None
        buckets = {}
        unknown = 0.0
        fixed = override.get('total_cost')
        unit = override.get('unit_price')
        source = 'none'
        if fixed is not None:
            fraction = 1 if full else selected_energy/total if number(selected_energy) and total and total>0 else None
            if fraction is not None:
                buckets[('', '', override['currency'], None, 'manual_total')] = [selected_energy, Decimal(str(fixed))*Decimal(str(fraction))]
                estimated = not full
            source = 'manual_total'
        elif unit is not None and number(selected_energy):
            buckets[('', '', override['currency'], unit, 'manual_rate')] = [selected_energy, Decimal(str(unit))*Decimal(str(selected_energy))]
            source = 'manual_rate'
        elif weights:
            for a,b,energy in weights:
                left, right = max(a,lo), min(b,hi)
                if right <= left: continue
                cuts = {left,right}
                cuts.update(range((int(left)//60+1)*60, int(right), 60))
                for p in self.plans:
                    if left < p['start_ts'] < right: cuts.add(p['start_ts'])
                    if left < p['end_ts'] < right: cuts.add(p['end_ts'])
                cuts = sorted(cuts); seen = set()
                for x,y in zip(cuts,cuts[1:]):
                    kwh = energy*(y-x)/(b-a)
                    rate = self.rate((x+y)/2, place, original['dc']); seen.add(rate)
                    if rate is None: unknown += kwh; continue
                    bucket = buckets.setdefault(rate,[0.0,Decimal(0)])
                    bucket[0] += kwh; bucket[1] += Decimal(str(kwh))*Decimal(str(rate[3]))
                if len(seen)>1: estimated=True
        elif number(total) and total == 0:
            rate = self.rate(lo,place,original['dc'])
            if rate: buckets[rate]=[0.0,Decimal(0)]
        totals = {}
        breakdown = []
        sources=set()
        for key,(energy,cost) in buckets.items():
            plan,label,currency,price,kind=key;sources.add(kind)
            cell=totals.setdefault(currency,{'currency':currency,'cost':Decimal(0),'kwh':0.0})
            cell['cost'] += cost
            if number(energy):cell['kwh'] += energy
            breakdown.append({'tariff_id':plan,'name':label,'currency':currency,'price':price,'kwh':energy,'cost':amount(cost),'source':kind})
        for item in totals.values():
            item['cost']=amount(item['cost'])
            lines=[r for r in breakdown if r['currency']==item['currency']]
            if lines:
                difference=amount(item['cost']-sum(r['cost'] for r in lines))
                lines[-1]['cost']=amount(lines[-1]['cost']+difference)
        complete = bool(buckets) and unknown < 1e-7 and (number(selected_energy) or fixed is not None and full)
        one = next(iter(totals.values())) if len(totals)==1 else None
        out.update(cost=one['cost'] if complete and one else None, known_cost=one['cost'] if one else None,
                   cost_currency=one['currency'] if one else None, cost_totals=list(totals.values()), cost_breakdown=breakdown,
                   cost_complete=complete, unpriced_kwh=unknown if number(selected_energy) else None,
                   billing_kwh=selected_energy, pricing_estimated=estimated,
                   pricing_source=next(iter(sources)) if len(sources)==1 else 'mixed' if sources else source,
                   price=one['cost']/selected_energy if one and complete and selected_energy else None)
        if not buckets and number(selected_energy):out['unpriced_kwh']=selected_energy
        return out


def summarize(rows):
    totals, places = {}, {}
    for r in rows:
        key = r.get('place_id') or ''
        group = places.setdefault(key,{'place_id':key,'name':r.get('place') or '', 'sessions':0,'kwh':0.0,'unpriced_kwh':0.0,'unpriced_sessions':0,'estimated_sessions':0,'currencies':{}})
        group['sessions']+=1;group['kwh']+=r.get('billing_kwh') or 0
        if not r['cost_complete']:group['unpriced_sessions']+=1
        group['unpriced_kwh']+=r.get('unpriced_kwh') or 0
        group['estimated_sessions']+=bool(r.get('pricing_estimated'))
        for cell in r['cost_totals']:
            for target in (totals,group['currencies']):
                target[cell['currency']]=target.get(cell['currency'],Decimal(0))+Decimal(str(cell['cost']))
    for group in places.values():group['currencies']=[{'currency':k,'cost':amount(v)} for k,v in group['currencies'].items()]
    return {'currencies':[{'currency':k,'cost':amount(v)} for k,v in totals.items()], 'places':list(places.values()),
            'sessions':len(rows),'kwh':sum(r.get('billing_kwh') or 0 for r in rows),'unpriced_sessions':sum(not r['cost_complete'] for r in rows),
            'unpriced_kwh':sum(r.get('unpriced_kwh') or 0 for r in rows),'estimated_sessions':sum(bool(r.get('pricing_estimated')) for r in rows)}
