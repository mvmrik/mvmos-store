// Game-agnostic generation from Game Hub's supplied catalogue, including local additions.
export function generatePerson(catalogue, {country = '', gender = 'mixed', family = null, random = Math.random} = {}) {
  const pick = values => values[Math.min(values.length - 1, Math.floor(random() * values.length))];
  country = family?.country || country || pick(Object.keys(catalogue));
  const data = catalogue[country];
  if (!data) throw new Error('Unknown name country');
  gender = gender === 'mixed' ? pick(['male', 'female']) : gender;
  if (!['male', 'female'].includes(gender)) throw new Error('Invalid name gender');
  const first = pick(data.groups[gender + '_first']);
  const families = family?.family_names || pick(data.groups[gender + '_last']).family_names;
  const last = families[gender];
  const given = family?.native_script === 'Latn' ? {...first, native:first.latin} : first;
  const parts = data.family_first ? [last, given] : [given, last];
  return {country, gender, native_script:family?.native_script || data.native_script,
    given_name:{native:first.native, latin:first.latin}, family_names:structuredClone(families),
    native:parts.map(p => p.native).join(data.separator), latin:parts.map(p => p.latin).join(' ')};
}
