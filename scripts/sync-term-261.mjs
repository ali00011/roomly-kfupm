import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';

const TERM = '261';
const TERM_CODE = '202610';
const SOURCE_URL = 'https://registrar.kfupm.edu.sa/course-offerings';
const OUTPUT_FILE = resolve('data/course-offerings-261.json');
const USER_AGENT = 'Roomly-KFUPM-Term-261-Sync/1.0';
const WAIT_BETWEEN_REQUESTS_MS = 350;

// The public page sometimes renders only the placeholder option on a direct
// GET request. These are the department options shown by the TERM 261 page.
// They are used only when the landing HTML does not include the options.
const TERM_261_DEPARTMENTS = [
  ['ACFN', 'Accounting & Finance'],
  ['AE', 'Aerospace Engineering'],
  ['AECM', 'Arch. Engg & Construction Mgt.'],
  ['ACD', 'Architecture and City Design'],
  ['BIOE', 'Bioengineering'],
  ['MBA', 'Business Administration'],
  ['CHE', 'Chemical Engineering'],
  ['CHEM', 'Chemistry'],
  ['CE', 'Civil & Environmental Engineering'],
  ['COE', 'Computer Engineering'],
  ['CIE', 'Control & Instrumentation Engineering'],
  ['EE', 'Electrical Engineering'],
  ['ELD', 'English Language Department'],
  ['ELI', 'English Language Inst. (Prep)'],
  ['ERTH', 'Geosciences'],
  ['GS', 'Global Studies'],
  ['ISE', 'Industrial and Systems Engineering'],
  ['ICS', 'Information & Computer Science'],
  ['ISOM', 'Information Systems & Operations Management'],
  ['ITD', 'Integrated Design'],
  ['IAS', 'Islamic & Arabic Studies'],
  ['LS', 'Life Sciences'],
  ['MGT', 'Management & Marketing'],
  ['MSE', 'Material Sciences and Engineering'],
  ['MATH', 'Mathematics'],
  ['ME', 'Mechanical Engineering'],
  ['CPG', 'Petroleum Engg. & Geo Sciences'],
  ['PETE', 'Petroleum Engineering'],
  ['PE', 'Physical Education'],
  ['PHYS', 'Physics'],
  ['PMP', 'Prep MATH Program'],
  ['PSE', 'Prep Science & Engineering'],
  ['URO', 'Undergraduate Research Office'],
].map(([code, name]) => ({ code, name }));

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isUsableRoomNumber(value) {
  const room = clean(value);
  if (!room || /^(none|null|undefined|n\/?a|tba|online|virtual|-)$/i.test(room)) return false;
  return /\d/.test(room);
}

function getCookies(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function parseTime(value) {
  const compact = clean(value).replace(/\s+/g, '').toUpperCase();
  const match = compact.match(/^(\d{3,4})(?:-|TO)(\d{3,4})$/);
  if (!match) return null;
  const toTime = (digits) => {
    const padded = digits.padStart(4, '0');
    const hours = Number(padded.slice(0, 2));
    const minutes = Number(padded.slice(2));
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };
  const start = toTime(match[1]);
  const end = toTime(match[2]);
  return start && end ? { start, end } : null;
}

function normalizeDays(value) {
  const source = clean(value).toUpperCase().replace(/TBA|ONLINE/g, '');
  return [...new Set(source.match(/[UMTWR]/g) || [])].join(' ');
}

function normalizeLocation(value) {
  const match = clean(value).match(/^(\d+)\s*-\s*(\S+)$/);
  if (!match || !isUsableRoomNumber(match[2])) return '';
  return `${match[1]}-${match[2]}`;
}

function parseCourseSection(value) {
  const match = clean(value).match(/^(.*?)-([^-]+)$/);
  return match ? { course: match[1], section: match[2] } : { course: clean(value), section: '' };
}

function extractRows(html, departmentCode, departmentName) {
  const $ = cheerio.load(html);
  return $('#data-table tbody tr').map((_, row) => {
    const cells = $(row).find('td').map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 8) return null;
    const courseSection = parseCourseSection(cells[0]);
    const time = parseTime(cells[6]);
    const days = normalizeDays(cells[5]);
    const location = normalizeLocation(cells[7]);
    if (!courseSection.course || !time || !days || !location) return null;
    return {
      course: courseSection.course,
      section: courseSection.section,
      activity: cells[1],
      crn: cells[2],
      courseName: cells[3],
      instructor: cells[4],
      departmentCode,
      department: departmentName,
      days,
      start: time.start,
      end: time.end,
      location,
      instructionalMethod: cells[8] || '',
    };
  }).get().filter(Boolean);
}

function dedupeOfferings(offerings) {
  const seen = new Set();
  return offerings.filter((offering) => {
    const key = [offering.crn, offering.activity, offering.days, offering.start, offering.end, offering.location].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roomsFromOfferings(offerings) {
  const seen = new Map();
  offerings.forEach((offering) => {
    const [building, ...roomParts] = offering.location.split('-');
    const room = roomParts.join('-');
    const key = `${building}-${room}`;
    if (!seen.has(key)) seen.set(key, {
      building,
      room,
      type: offering.activity === 'LAB' ? 'Lab' : 'Classroom',
      capacity: null,
      source: 'offering',
    });
  });
  return [...seen.values()].sort((a, b) => Number(a.building) - Number(b.building) || String(a.room).localeCompare(String(b.room)));
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response;
}

async function main() {
  console.log(`Fetching official KFUPM course offerings for TERM ${TERM}…`);
  const landingResponse = await fetchText(SOURCE_URL);
  const landingHtml = await landingResponse.text();
  const $landing = cheerio.load(landingHtml);
  const csrfToken = $landing('input[name="csrfmiddlewaretoken"]').attr('value');
  const formAction = new URL($landing('#course_form').attr('action') || '/course-offerings', SOURCE_URL).href;
  const termOption = $landing('#term_code option').filter((_, option) => clean($landing(option).text()) === `Term ${TERM}`).first();
  const termCode = termOption.attr('value') || TERM_CODE;
  if (termCode !== TERM_CODE) throw new Error(`Expected TERM ${TERM} to map to ${TERM_CODE}, got ${termCode}`);
  if (!csrfToken) throw new Error('The official page did not provide a CSRF token.');

  const pageDepartments = $landing('#dept_code option').map((_, option) => ({
    code: $landing(option).attr('value'),
    name: clean($landing(option).text()),
  })).get().filter((department) => department.code && department.code !== 'select');
  const departments = pageDepartments.length ? pageDepartments : TERM_261_DEPARTMENTS;
  if (!pageDepartments.length) {
    console.log('The landing page did not include department options; using the TERM 261 department list.');
  }
  if (!departments.length) throw new Error('No department options were found.');
  console.log(`Found ${departments.length} departments. Downloading every department…`);

  const cookie = getCookies(landingResponse);
  const offerings = [];
  for (const [index, department] of departments.entries()) {
    const body = new URLSearchParams({
      csrfmiddlewaretoken: csrfToken,
      term_code: termCode,
      dept_code: department.code,
      page_choice: 'CO',
    });
    const response = await fetchText(formAction, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        referer: SOURCE_URL,
        ...(cookie ? { cookie } : {}),
      },
      body,
    });
    const html = await response.text();
    const departmentRows = extractRows(html, department.code, department.name);
    offerings.push(...departmentRows);
    console.log(`  ${index + 1}/${departments.length} ${department.code}: ${departmentRows.length} rows`);
    await sleep(WAIT_BETWEEN_REQUESTS_MS);
  }

  const current = JSON.parse(await readFile(OUTPUT_FILE, 'utf8').catch(() => '{"rooms":[]}'));
  const normalizedOfferings = dedupeOfferings(offerings);
  const derivedRooms = roomsFromOfferings(normalizedOfferings);
  const curatedRooms = current.mode === 'preview' ? [] : (current.rooms || []).filter((room) => (
    /^\d+$/.test(String(room.building ?? '').trim()) && isUsableRoomNumber(room.room)
  ));
  const rooms = [...curatedRooms, ...derivedRooms].filter((room, index, all) => (
    all.findIndex((candidate) => `${candidate.building}-${candidate.room}` === `${room.building}-${room.room}`) === index
  ));
  const previousContent = JSON.stringify({
    departmentCount: current.departmentCount || 0,
    rooms: current.rooms || [],
    offerings: current.offerings || [],
  });
  const nextContent = JSON.stringify({
    departmentCount: departments.length,
    rooms,
    offerings: normalizedOfferings,
  });
  const contentChanged = previousContent !== nextContent;
  const output = {
    term: TERM,
    source: SOURCE_URL,
    sourceTermCode: termCode,
    mode: 'synced',
    fetchedAt: contentChanged ? new Date().toISOString() : (current.fetchedAt || new Date().toISOString()),
    departmentCount: departments.length,
    offeringCount: normalizedOfferings.length,
    note: 'Synced from the official TERM 261 Course Offering page. Rooms observed in offering rows are included; add a verified room inventory separately to include rooms with no scheduled offering.',
    rooms,
    offerings: normalizedOfferings,
  };
  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Saved ${normalizedOfferings.length} offerings across ${departments.length} departments to ${OUTPUT_FILE}`);
  console.log(`Saved ${rooms.length} observed rooms. Add a verified campus room inventory for unscheduled rooms.`);
}

main().catch((error) => {
  console.error(`Sync failed: ${error.message}`);
  process.exitCode = 1;
});
