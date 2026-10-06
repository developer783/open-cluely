const { getDefaultTeamServerUrl } = require('../../config');

// Team server settings: the URL comes from Settings or the default in
// src/config.js; the access code is entered per user in Settings.
function resolveTeamServer(appState) {
  const url = String(appState?.teamServerUrl || getDefaultTeamServerUrl() || '').trim().replace(/\/+$/, '');
  const accessCode = String(appState?.teamAccessCode || '').trim();
  return url && accessCode ? { url, accessCode } : null;
}

module.exports = {
  resolveTeamServer
};
