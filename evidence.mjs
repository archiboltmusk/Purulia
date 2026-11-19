const status = document.getElementById('gap-status');
const gaps = document.getElementById('gaps');

try {
  const response = await fetch('places/money.json', { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Coverage feed unavailable');
  const { missing, checked } = await response.json();
  if (!Array.isArray(missing)) throw new Error('Invalid coverage feed');
  status.textContent = missing.length ? missing.length + ' gaps listed · spending coverage checked ' + checked : 'No gaps listed in the spending coverage file.';
  for (const gap of missing) {
    const card = document.createElement('article');
    const heading = document.createElement('h3');
    heading.textContent = gap.what;
    const where = document.createElement('p');
    where.textContent = 'Where to look · ' + gap.where;
    const reason = document.createElement('p');
    reason.textContent = 'Status when checked · ' + gap.why;
    card.append(heading, where, reason);
    gaps.append(card);
  }
} catch {
  status.textContent = 'The spending coverage file is unavailable. You can still open the source and request links above.';
}
