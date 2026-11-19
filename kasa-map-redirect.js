const mapUrl = new URL('kasa.html', location.href);
const districtSlug = new URLSearchParams(location.search).get('d');
mapUrl.searchParams.set('intelligence', document.currentScript.dataset.section);
if (districtSlug) mapUrl.searchParams.set('d', districtSlug);
location.replace(mapUrl);
