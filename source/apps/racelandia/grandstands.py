"""Physical spectator facilities. Capacity and invoices are derived from their footprints."""
import math
import re

KINDS = ('seated', 'free', 'vip')


def dimensions(kind, length, rows):
    depth = rows * {'seated': .85, 'free': 1., 'vip': 4.}[kind] + (3 if kind == 'seated' else 0)
    capacity = {'seated': lambda: math.floor(length / .5) * rows,
                'free': lambda: math.floor(length * depth * 2),
                'vip': lambda: math.floor(length / 2) * rows}[kind]()
    return depth, capacity


def corners(s, margin=0):
    a=s['angle'];c=math.cos(a);n=math.sin(a);w=s['length']/2+margin;h=s['depth']/2+margin
    return [(s['x']+c*x-n*y,s['y']+n*x+c*y) for x,y in [(-w,-h),(w,-h),(w,h),(-w,h)]]


def overlap(a,b,margin=0):
    pa,pb=corners(a,margin),corners(b)
    for s in (a,b):
        for axis in [(math.cos(s['angle']),math.sin(s['angle'])),(-math.sin(s['angle']),math.cos(s['angle']))]:
            x=[p[0]*axis[0]+p[1]*axis[1] for p in pa];y=[p[0]*axis[0]+p[1]*axis[1] for p in pb]
            if max(x)<=min(y) or max(y)<=min(x):return False
    return True


def segment_hits(s,a,b,margin):
    c,n=math.cos(s['angle']),math.sin(s['angle'])
    def local(p):
        x,y=p[0]-s['x'],p[1]-s['y'];return (x*c+y*n,-x*n+y*c)
    p,q=local(a),local(b);w,h=s['length']/2+margin,s['depth']/2+margin
    low,high=0.,1.
    for pos,delta,bound in [(p[0],q[0]-p[0],w),(p[1],q[1]-p[1],h)]:
        if abs(delta)<1e-10:
            if abs(pos)>bound:return False
        else:
            x,y=(-bound-pos)/delta,(bound-pos)/delta
            low=max(low,min(x,y));high=min(high,max(x,y))
            if low>high:return False
    return True


def bounds(own):
    # The circuit's land parcel, including 500 metres of surrounding buildable land.
    pts=own['points']
    return dict(min_x=min(p[0] for p in pts)-500,max_x=max(p[0] for p in pts)+500,
                min_y=min(p[1] for p in pts)-500,max_y=max(p[1] for p in pts)+500)


def pit_area(own):
    pts=own['points'];i=round(own.get('start',0)*len(pts)/max(1,round(own['length']/3)))%len(pts)
    a,b=pts[(i-5)%len(pts)],pts[(i+5)%len(pts)]
    return dict(x=pts[i][0],y=pts[i][1],angle=math.atan2(b[1]-a[1],b[0]-a[0]),length=750,depth=150)


def validate(raw,own):
    if not isinstance(raw,list):return None,'stand_invalid'
    land=bounds(own)
    layout=[];ids=set();road=own['width']/2+own.get('runoff',18)+3;pit=pit_area(own);pts=own['points']
    for item in raw:
        if not isinstance(item,dict):return None,'stand_invalid'
        ident=item.get('id');kind=item.get('kind')
        if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',ident) or ident in ids or kind not in KINDS:return None,'stand_invalid'
        values=[]
        for key in ['x','y','angle','length','rows']:
            v=item.get(key)
            if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v):return None,'stand_invalid'
            values.append(v)
        x,y,angle,length,rows=values
        if length<4 or rows<1 or rows!=int(rows):return None,'stand_invalid'
        length=round(length,3)
        try:depth,capacity=dimensions(kind,length,int(rows))
        except (OverflowError,ValueError):return None,'stand_invalid'
        # Numerical integrity, not a game capacity cap: prices and stored amounts must remain exact.
        if not math.isfinite(depth) or not 0<capacity<=2**53-1 or max(abs(x),abs(y),length,depth)>2**53-1:return None,'stand_invalid'
        s=dict(id=ident,kind=kind,x=round(x,3),y=round(y,3),angle=round(angle%(2*math.pi),6),length=round(length,3),rows=int(rows),depth=round(depth,3),capacity=capacity)
        if any(not(land['min_x']<=x<=land['max_x'] and land['min_y']<=y<=land['max_y']) for x,y in corners(s)):return None,'stand_land'
        if overlap(s,pit) or any(segment_hits(s,a,b,road) for a,b in zip(pts,pts[1:]+pts[:1])):return None,'stand_track'
        if any(overlap(s,other,2) for other in layout):return None,'stand_overlap'
        ids.add(ident);layout.append(s)
    return layout,None


def totals(layout):
    return {k:sum(s['capacity'] for s in layout if s['kind']==k) for k in KINDS}


def invoice(own,layout,costs):
    old={s['id']:s for s in own.get('grandstands',[])}
    if 'grandstands' not in own:
        # Previously purchased, unpositioned capacity is credited once when placing it.
        seats=totals(layout)
        return sum(max(0,seats[k]-own.get('seats',{}).get(k,0))*costs[k] for k in KINDS)
    return sum(max(0,s['capacity']-(old[s['id']]['capacity'] if s['id'] in old and old[s['id']]['kind']==s['kind'] else 0))*costs[s['kind']] for s in layout)
