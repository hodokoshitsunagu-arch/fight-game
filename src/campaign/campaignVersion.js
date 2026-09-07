export function campaignVersionFromSearch(search = '') {
  const version = new URLSearchParams(search).get('campaign');
  if (version === 'v2') return 2;
  if (version === 'v3') return 3;
  return 1;
}
