"""Game Hub's name catalogue. Bundled defaults stay separate from local additions."""
import hashlib
import json
import random
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

_APP_DIR = Path(__file__).resolve().parents[3] / 'apps' / 'gamehub'
# The installer routes bundled data into public/. The development tree keeps
# its source data beside public/; prefer the installed layout when present.
_DATA_ROOT = _APP_DIR / 'public' / 'data'
if not _DATA_ROOT.is_dir():
    _DATA_ROOT = _APP_DIR / 'data'
DATA_DIR = _DATA_ROOT / 'names'
PERSON_GROUPS = ('male_first', 'female_first', 'male_last', 'female_last')
TEAM_GROUPS = ('prefix', 'suffix')


@lru_cache(maxsize=1)
def defaults():
    return {p.stem: json.loads(p.read_text(encoding='utf-8')) for p in sorted(DATA_DIR.glob('*.json'))}



@lru_cache(maxsize=1)
def display_rules():
    """Shared script capabilities for every catalogue consumer, independent of games."""
    return json.loads((DATA_DIR.parent / 'name-display.json').read_text(encoding='utf-8'))


def display_name(identity, lang='en'):
    """Choose a spelling of an existing identity without generating a new name.

    Viewer language supplies a conservative default for readable scripts; nationality
    never determines what the viewer can read. Unknown languages use Latin spelling.
    """
    if identity.get('custom_name'):
        return identity['custom_name']
    rules = display_rules()
    normalized = lang.replace('_', '-').lower()
    language_scripts = {key.lower(): value for key, value in rules['language_scripts'].items()}
    scripts = language_scripts.get(normalized, language_scripts.get(normalized.split('-')[0], ['Latn']))
    script = identity.get('native_script')
    if not script:
        # Older saved identities have a country but no explicit script metadata.
        source_language = country_data(identity['country'])['language']
        script = rules['native_scripts'].get(source_language)
    return identity['native'] if script in scripts else identity['latin']


def schema(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS name_catalog_custom (
        id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT NOT NULL,
        category TEXT NOT NULL, native TEXT NOT NULL, latin TEXT NOT NULL,
        UNIQUE(country, category, native))''')


def country_data(country):
    data = defaults().get(country)
    if data is None:
        raise HTTPException(404, 'Unknown country')
    return data


def entries(conn, country, group):
    data = country_data(country)
    if group not in data['groups']:
        raise HTTPException(422, 'Invalid category')
    out = [dict(id='default-' + hashlib.sha256(f'{country}:{group}:{v[0]}'.encode()).hexdigest()[:20],
                native=v[0], latin=v[1], custom=False) for v in data['groups'][group]]
    out.extend(dict(id=str(row['id']), native=row['native'], latin=row['latin'], custom=True)
               for row in conn.execute('SELECT id,native,latin FROM name_catalog_custom WHERE country=? AND category=? ORDER BY id', (country, group)))
    return out


def clean(value):
    value = unicodedata.normalize('NFC', value).strip()
    if not value or any(unicodedata.category(c).startswith('C') for c in value) or any(c in '<>"{}\\/' for c in value):
        raise HTTPException(422, 'Invalid name')
    return value


def latin_text(value):
    value = clean(value)
    if any(c.isalpha() and 'LATIN' not in unicodedata.name(c, '') for c in value):
        raise HTTPException(422, 'Latin spelling must use Latin letters')
    if not any(c.isalpha() for c in value):
        raise HTTPException(422, 'A name must contain letters')
    return value


class EntryBody(BaseModel):
    category: str
    native: str = Field(min_length=1, max_length=100)
    latin: str = Field(min_length=1, max_length=100)


class PreviewBody(BaseModel):
    country: str = ''
    gender: str = 'mixed'
    lang: str = 'en'
    count: int = Field(default=12, ge=1, le=50)


def country_for_language(language='en'):
    locale = str(language or 'en').replace('_', '-').lower()
    countries = {d['language'].lower(): c for c, d in defaults().items() if c != 'teams'}
    return countries.get(locale, countries.get(locale.split('-')[0],
                         next((c for lang, c in countries.items() if lang.split('-')[0] == locale.split('-')[0]), 'US')))


def family_names(country, gender, last):
    """Store both grammatical forms; never infer a surname from a full name."""
    native, latin = last['native'], last['latin']
    other_native, other_latin = native, latin
    endings = {
        'BG': [('ов', 'ова', 'ov', 'ova'), ('ев', 'ева', 'ev', 'eva'), ('ски', 'ска', 'ski', 'ska')],
        'RU': [('ов', 'ова', 'ov', 'ova'), ('ев', 'ева', 'ev', 'eva'), ('ин', 'ина', 'in', 'ina'),
               ('ый', 'ая', 'y', 'aya'), ('ий', 'ая', 'y', 'aya'), ('ой', 'ая', 'oy', 'aya')],
    }
    for male, female, ml, fl in endings.get(country, []):
        old, new, old_latin, new_latin = (male, female, ml, fl) if gender == 'male' else (female, male, fl, ml)
        if native.endswith(old):
            other_native = native[:-len(old)] + new
            # Prefer an attested counterpart, including its catalogue spelling.
            other_group = ('female' if gender == 'male' else 'male') + '_last'
            counterpart = next((v for v in country_data(country)['groups'][other_group] if v[0] == other_native), None)
            other_latin = counterpart[1] if counterpart else (latin[:-len(old_latin)] + new_latin if latin.endswith(old_latin) else latin)
            break
    original = dict(native=native, latin=latin)
    other = dict(native=other_native, latin=other_latin)
    return {gender: original, 'female' if gender == 'male' else 'male': other}


def catalogue(conn):
    """Serializable pools, including local additions, for offline simulations."""
    schema(conn)
    result = {}
    for code, data in defaults().items():
        if code == 'teams':
            continue
        groups = {group: entries(conn, code, group) for group in PERSON_GROUPS}
        for gender in ('male', 'female'):
            for row in groups[gender + '_last']:
                row['family_names'] = family_names(code, gender, row)
        result[code] = dict(language=data['language'], family_first=data['family_first'],
                            separator=data['separator'], native_script=display_rules()['native_scripts'][data['language']], groups=groups)
    return result


def generate(conn, *, country='', gender='mixed', lang='en', count=12, rng=None):
    """Create identities from a country and gender without knowing the caller.

    Keep native/Latin spellings and origin together. Consumers can store this result
    and choose its display spelling later without generating a different identity.
    An optional random.Random allows reproducible generation by a consumer.
    """
    if not isinstance(count, int) or not 1 <= count <= 1000:
        raise HTTPException(422, 'Invalid count')
    if gender not in ('male', 'female', 'mixed'):
        raise HTTPException(422, 'Invalid gender')
    if country:
        country_data(country)
    codes = [country] if country else [c for c in defaults() if c != 'teams']
    rnd = rng or random.SystemRandom()
    result, used = [], set()
    schema(conn)
    pools = {(code, group): entries(conn, code, group) for code in codes for group in country_data(code)['groups']}
    for _ in range(count * 30):
        code = rnd.choice(codes)
        data = country_data(code)
        sex = rnd.choice(('male', 'female')) if gender == 'mixed' else gender
        g1, g2 = TEAM_GROUPS if code == 'teams' else (sex + '_first', sex + '_last')
        first, last = rnd.choice(pools[code, g1]), rnd.choice(pools[code, g2])
        if code == 'teams':
            native = latin = first['latin'] + ' ' + last['latin']
        else:
            native_parts = [last['native'], first['native']] if data['family_first'] else [first['native'], last['native']]
            native = data['separator'].join(native_parts)
            latin_parts = [last['latin'], first['latin']] if data['family_first'] else [first['latin'], last['latin']]
            latin = ' '.join(latin_parts)
        key = (code, latin)
        if key in used:
            continue
        used.add(key)
        identity = dict(country=code, gender=sex if code != 'teams' else None, native=native, latin=latin,
                        native_script=display_rules()['native_scripts'][data['language']])
        if code != 'teams':
            identity['given_name'] = dict(native=first['native'], latin=first['latin'])
            identity['family_names'] = family_names(code, sex, last)
        identity['display'] = display_name(identity, lang)
        result.append(identity)
        if len(result) == count:
            break
    return result


def make_router(get_db, get_session):
    router = APIRouter(prefix='/api/gamehub/names', tags=['gamehub-names'], dependencies=[Depends(get_session)])

    def admin(session=Depends(get_session)):
        if session.get('effective_user') != 'root':
            raise HTTPException(403, 'Administrator access required')
        return session

    @router.get('')
    def index(session=Depends(get_session)):
        with get_db() as conn:
            schema(conn)
            countries = []
            for code, data in defaults().items():
                counts = {g: len(entries(conn, code, g)) for g in data['groups']}
                countries.append(dict(code=code, language=data['language'], name=data['name'], counts=counts))
        return dict(countries=countries, editable=session.get('effective_user') == 'root')

    @router.post('/preview')
    def preview(body: PreviewBody):
        with get_db() as conn:
            return dict(examples=generate(conn, country=body.country, gender=body.gender,
                                          lang=body.lang, count=body.count))

    @router.get('/{country}')
    def detail(country: str, category: str = '', q: str = '', offset: int = 0, limit: int = 50):
        data = country_data(country)
        group = category or next(iter(data['groups']))
        if not 1 <= limit <= 100 or offset < 0 or len(q) > 100:
            raise HTTPException(422, 'Invalid page')
        with get_db() as conn:
            schema(conn)
            rows = entries(conn, country, group)
        needle = q.strip().casefold()
        if needle:
            rows = [v for v in rows if needle in v['native'].casefold() or needle in v['latin'].casefold()]
        return dict(code=country, language=data['language'], name=data['name'], category=group,
                    groups=list(data['groups']), total=len(rows), entries=rows[offset:offset + limit], sources=data.get('sources', []))

    @router.post('/{country}/entries', dependencies=[Depends(admin)])
    def add(country: str, body: EntryBody):
        data = country_data(country)
        if body.category not in data['groups']:
            raise HTTPException(422, 'Invalid category')
        native, latin = clean(body.native), latin_text(body.latin)
        if not any(c.isalpha() for c in native):
            raise HTTPException(422, 'A name must contain letters')
        if country == 'teams':
            if not re.fullmatch(r'[A-Za-z]+(?:[- ][A-Za-z]+)*', native) or native != latin:
                raise HTTPException(422, 'Team words must be in English with matching spellings')
        with get_db() as conn:
            schema(conn)
            # Serialize the duplicate check with writes from other administrators.
            conn.execute('BEGIN IMMEDIATE')
            if any(v['native'].casefold() == native.casefold() for v in entries(conn, country, body.category)):
                raise HTTPException(409, 'Name already exists')
            row = conn.execute('INSERT INTO name_catalog_custom(country,category,native,latin) VALUES(?,?,?,?)',
                               (country, body.category, native, latin))
            ident = row.lastrowid
        return dict(id=str(ident), native=native, latin=latin, custom=True)

    @router.delete('/{country}/entries/{entry_id}', dependencies=[Depends(admin)])
    def remove(country: str, entry_id: int):
        country_data(country)
        with get_db() as conn:
            schema(conn)
            if conn.execute('DELETE FROM name_catalog_custom WHERE country=? AND id=?', (country, entry_id)).rowcount != 1:
                raise HTTPException(404, 'Custom name not found')
        return dict(ok=True)

    return router
