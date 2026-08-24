import { parseCatalog } from '../services/classCatalog';

/** Header row 0 spans column groups; row 1 carries the real names. */
const HEADER =
  ',,,,,,,,,,,,,,,,,Weeks Offered,,,,,,,,,Course days and time,,,,,,,,\n' +
  'id,Title,Category,Instructor,Description,Weeks,Day/Time,Fee,Fee - Materials,Youth?,' +
  'Student Materials,Instructor Materials,Min Age,Max Age,Caregiver,Location,Room,' +
  'W1,W2,W3,W4,W5,W6,W7,W8,W9,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Start,End\n';

interface RowOverrides { [column: string]: string }

function row(over: RowOverrides = {}): string {
  const base: RowOverrides = {
    id: '1', Title: 'Watercolour', Category: 'Art', Instructor: 'A Painter',
    Description: 'Paint.', Weeks: 'Wk 2', 'Day/Time': 'M/9-10a.m.', Fee: '$115',
    'Fee - Materials': '', 'Youth?': 'FALSE', 'Student Materials': 'FALSE',
    'Instructor Materials': 'TRUE', 'Min Age': '18', 'Max Age': '', Caregiver: 'FALSE',
    Location: 'Hultquist', Room: '101',
    W1: 'FALSE', W2: 'TRUE', W3: 'FALSE', W4: 'FALSE', W5: 'FALSE',
    W6: 'FALSE', W7: 'FALSE', W8: 'FALSE', W9: 'FALSE',
    Mon: 'TRUE', Tue: 'FALSE', Wed: 'FALSE', Thu: 'FALSE', Fri: 'FALSE',
    Sat: 'FALSE', Sun: 'FALSE', Start: '9:00 AM', End: '10:00 AM',
  };
  const merged = { ...base, ...over };
  const cols = HEADER.split('\n')[1].split(',');
  return cols.map((c) => {
    const v = merged[c] ?? '';
    return v.includes(',') ? `"${v}"` : v;
  }).join(',');
}

const csv = (...rows: string[]) => HEADER + rows.join('\n') + '\n';

describe('parseCatalog', () => {
  it('reads the schedule out of the week and day columns', () => {
    const [c] = parseCatalog(csv(row({ W2: 'TRUE', W5: 'TRUE', Wed: 'TRUE' })));
    expect(c.weeks).toEqual([2, 5]);
    expect(c.daysOfWeek).toEqual(['Monday', 'Wednesday']);
    expect(c.startTime).toBe('9:00 AM');
  });

  it('keeps location and room apart, which the ticket site does not', () => {
    const [c] = parseCatalog(csv(row()));
    expect(c.location).toBe('Hultquist');
    expect(c.room).toBe('101');
  });

  it('reads ages as numbers, treating a blank bound as unbounded', () => {
    const [open] = parseCatalog(csv(row({ 'Min Age': '18', 'Max Age': '' })));
    expect(open.ageRange).toEqual({ min: 18, max: null });

    const [bounded] = parseCatalog(csv(row({ 'Min Age': '6', 'Max Age': '8' })));
    expect(bounded.ageRange).toEqual({ min: 6, max: 8 });

    const [none] = parseCatalog(csv(row({ 'Min Age': '', 'Max Age': '' })));
    expect(none.ageRange).toEqual({ min: null, max: null });
  });

  it('collapses one class printed under several categories into one record', () => {
    const catalog = parseCatalog(csv(
      row({ id: '1', Category: 'Art' }),
      row({ id: '2', Category: 'Handcrafts' }),
    ));
    expect(catalog).toHaveLength(1);
    expect(catalog[0].categories).toEqual(['Art', 'Handcrafts']);
    // The first row's id wins, so the record has a stable identity.
    expect(catalog[0].id).toBe('1');
  });

  it('keeps two offerings of the same title apart', () => {
    // The catalog prints "Monday Session" and "Tuesday Session" as separate
    // classes at different times. Collapsing on title alone would merge them.
    const catalog = parseCatalog(csv(
      row({ id: '1', Title: 'Watercolour', 'Day/Time': 'M/9-10a.m.' }),
      row({ id: '2', Title: 'Watercolour', 'Day/Time': 'Tu/9-10a.m.', Mon: 'FALSE', Tue: 'TRUE' }),
    ));
    expect(catalog).toHaveLength(2);
    expect(catalog.map((c) => c.daysOfWeek)).toEqual([['Monday'], ['Tuesday']]);
  });

  it('reads the TRUE/FALSE strings the sheet actually contains', () => {
    const [c] = parseCatalog(csv(row({
      Caregiver: 'TRUE', 'Student Materials': 'TRUE', 'Instructor Materials': 'FALSE',
      'Fee - Materials': '$20',
    })));
    expect(c.caregiver).toBe(true);
    expect(c.materials).toEqual({ fee: '$20', student: true, instructor: false });
  });

  it('ignores rows with no id or title', () => {
    expect(parseCatalog(csv(row(), row({ id: '', Title: '' })))).toHaveLength(1);
  });
});
