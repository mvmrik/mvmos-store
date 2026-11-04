"""Rebuild the shipped circuit catalog from pinned source coordinates, then drive each new track.

Run with the installation's Python: tools/build-circuits.py [--workers 3].
Existing Zandvoort geometry is retained to preserve its records and paid sessions.
No download or network dependency is needed at runtime or during this build.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import importlib.util
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('circuit_tools', ROOT / 'tracks.py')
tracks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tracks)
REVISION = '8094e957b8d6aa8b9f4510c93968556cccd30e02'
SOURCE = 'https://github.com/bacinger/f1-circuits/tree/' + REVISION
# Source ID, app ID, display name, country, driving direction, approximate paved width.
CIRCUITS = [
 ('au-1953','melbourne','Albert Park','AU','cw',12),
 ('bh-2002','bahrain','Bahrain','BH','cw',14),
 ('cn-2004','shanghai','Shanghai','CN','cw',14),
 ('es-1991','barcelona','Barcelona-Catalunya','ES','cw',12),
 ('mc-1929','monaco','Monaco','MC','cw',9.5),
 ('ca-1978','montreal','Gilles Villeneuve','CA','cw',12),
 ('at-1969','spielberg','Red Bull Ring','AT','cw',12),
 ('gb-1948','silverstone','Silverstone','GB','cw',14),
 ('hu-1986','hungaroring','Hungaroring','HU','cw',12),
 ('be-1925','spa','Spa-Francorchamps','BE','cw',12),
 ('it-1922','monza','Monza','IT','cw',12),
 ('sg-2008','singapore','Marina Bay','SG','ccw',12),
 ('jp-1962','suzuka','Suzuka','JP','cw',12),
 ('us-2012','austin','Circuit of the Americas','US','ccw',14),
 ('mx-1962','mexico','Hermanos Rodriguez','MX','cw',12),
 ('br-1940','interlagos','Interlagos','BR','ccw',12),
 ('ae-2009','yas-marina','Yas Marina','AE','ccw',14),
 ('it-1953','imola','Imola','IT','ccw',12),
 ('sa-2021','jeddah','Jeddah Corniche','SA','ccw',12),
 ('us-2022','miami','Miami','US','ccw',12),
 ('qa-2004','lusail','Lusail','QA','cw',12),
 ('az-2016','baku','Baku','AZ','ccw',10),
 ('us-2023','las-vegas','Las Vegas','US','ccw',14),
]


def definition(config, features, locations):
    source_id, ident, name, country, direction, width = config
    feature = features[source_id]
    gps = feature['geometry']['coordinates']
    loc = locations[source_id]
    # WGS84 local tangent-plane approximation; coordinates remain in metres.
    lat, lon = loc['lat'], loc['lon']
    pts = [(math.radians(p[0]-lon)*6371000*math.cos(math.radians(lat)),
            math.radians(p[1]-lat)*6371000) for p in gps]
    if math.dist(pts[0],pts[-1]) < 1: pts.pop()
    pts = [p for i,p in enumerate(pts) if not i or math.dist(p,pts[i-1]) > .1]
    area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1]))
    if (area > 0) != (direction == 'ccw'): pts.reverse()
    smooth, length = tracks.spline(pts, ds=5)
    # Keep the source's published lap length while smoothing the GPS polyline.
    scale = feature['properties']['length'] / length
    smooth = [[round(x*scale,3),round(y*scale,3)] for x,y in smooth]
    return dict(id=ident,name=name,country=country,lat=lat,lon=lon,points=smooth,
                width=width,runoff=18,sectors=[.34,.68],direction=direction,
                race_laps=78 if ident=='monaco' else math.ceil(305000/feature['properties']['length']),
                source='Tomislav Bacinger / f1-circuits (MIT)',source_url=SOURCE,
                source_id=source_id,source_length=feature['properties']['length'])


def measure(defn):
    result = tracks.measure(defn)
    if not result or not result.get('best'):
        raise RuntimeError('No clean reference lap: ' + defn['id'])
    return dict(defn,start=result['start'],length=round(result['length'],3),
                ref=tracks.ref_from_best(result['best']),profile=result['profile'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers',type=int,default=3)
    parser.add_argument('--output',type=Path,default=ROOT/'public/tracks.json')
    args=parser.parse_args()
    features={f['properties']['id']:f for f in json.loads((ROOT/'data/f1-circuits.geojson').read_text())['features']}
    locations={f['id']:f for f in json.loads((ROOT/'data/f1-locations.json').read_text())}
    existing=json.loads((ROOT/'public/tracks.json').read_text())
    catalog={'zandvoort':existing['zandvoort']}
    errors=[]
    with ThreadPoolExecutor(max_workers=max(1,min(4,args.workers))) as pool:
        jobs={pool.submit(measure,definition(config,features,locations)):config[1] for config in CIRCUITS}
        for job in as_completed(jobs):
            ident=jobs[job]
            try:
                catalog[ident]=job.result()
                print(ident,round(catalog[ident]['length']),catalog[ident]['ref']['best'],flush=True)
            except Exception as e:
                errors.append(str(e));print(str(e),file=sys.stderr,flush=True)
    if errors: raise SystemExit('Catalog not written: '+ '; '.join(errors))
    # Publish the catalog only after all tracks have a measured valid lap.
    tmp=args.output.with_suffix('.tmp')
    tmp.write_text(json.dumps(dict(sorted(catalog.items())),ensure_ascii=False,separators=(',',':'))+'\n')
    tmp.replace(args.output)
    print('Wrote',len(catalog),'circuits to',args.output,flush=True)


if __name__=='__main__': main()
