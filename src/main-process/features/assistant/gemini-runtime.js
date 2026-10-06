const GeminiService = require('../../../services/ai/gemini-service');
const OllamaService = require('../../../services/ai/ollama-service');
const {
  resolveAiProvider,
  getAiProviders,
  getDefaultAiProvider,
  getDefaultOllamaBaseUrl,
  getDefaultOllamaModel,
  resolveGeminiModel,
  resolveProgrammingLanguage,
  getGeminiModels,
  getDefaultGeminiModel,
  getProgrammingLanguages,
  getDefaultProgrammingLanguage
} = require('../../../config');

const GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE = 'GEMINI_ALL_KEYS_UNAVAILABLE';

function normalizeGeminiApiKeys(keys) {
  const sourceValues = Array.isArray(keys)
    ? keys
    : String(keys ?? '').split(',');
  const seen = new Set();
  const nextKeys = [];

  for (const rawValue of sourceValues) {
    const key = String(rawValue || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextKeys.push(key);
  }

  return nextKeys;
}

// Stand-in "key" meaning: send Gemini requests through the team server, which
// adds the real key server-side. Used only when the user has no key of their own.
const TEAM_SERVER_KEY = 'team-server';

function createGeminiRuntime() {
  let geminiService = null;
  let ollamaService = null;
  let activeAiProvider = getDefaultAiProvider();
  let activeGeminiModel = getDefaultGeminiModel();
  let activeProgrammingLanguage = getDefaultProgrammingLanguage();
  let activeOllamaBaseUrl = getDefaultOllamaBaseUrl();
  let activeOllamaModel = getDefaultOllamaModel();
  let geminiApiKeys = [];
  let userApiKeys = [];
  let teamServer = null;
  let activeApiKeyIndex = 0;
  let activeKeyIndexChangeHandler = null;

  function notifyActiveKeyIndexChanged(index) {
    if (typeof activeKeyIndexChangeHandler !== 'function') {
      return;
    }

    try {
      activeKeyIndexChangeHandler(index);
    } catch (error) {
      console.error('Failed to persist active Gemini API key index:', error);
    }
  }

  function normalizeKeyIndex(index) {
    if (geminiApiKeys.length === 0) {
      return 0;
    }

    const parsedIndex = Number.parseInt(String(index ?? ''), 10);
    const safeIndex = Number.isFinite(parsedIndex) ? parsedIndex : 0;
    const maxIndex = geminiApiKeys.length - 1;

    return Math.min(Math.max(safeIndex, 0), maxIndex);
  }

  function setActiveApiKeyIndex(index, options = {}) {
    const nextIndex = normalizeKeyIndex(index);
    const shouldNotify = options.notify !== false;
    const changed = nextIndex !== activeApiKeyIndex;
    activeApiKeyIndex = nextIndex;

    if (changed && shouldNotify) {
      notifyActiveKeyIndexChanged(activeApiKeyIndex);
    }

    return activeApiKeyIndex;
  }

  function getActiveApiKey() {
    if (geminiApiKeys.length === 0) {
      return '';
    }

    return geminiApiKeys[activeApiKeyIndex] || '';
  }

  function hasApiKeys() {
    return geminiApiKeys.length > 0;
  }

  function getEffectiveApiKeys() {
    if (userApiKeys.length > 0) return [...userApiKeys];
    return teamServer ? [TEAM_SERVER_KEY] : [];
  }

  function isUsingTeamServer() {
    return userApiKeys.length === 0 && Boolean(teamServer);
  }

  function setTeamServer({ url, accessCode } = {}) {
    const normalizedUrl = String(url || '').trim().replace(/\/+$/, '');
    const normalizedCode = String(accessCode || '').trim();
    teamServer = normalizedUrl && normalizedCode ? { url: normalizedUrl, accessCode: normalizedCode } : null;
    geminiApiKeys = getEffectiveApiKeys();
    setActiveApiKeyIndex(activeApiKeyIndex, { notify: false });
    // Force a rebuild so the service picks up the new routing.
    geminiService = null;
    return isUsingTeamServer();
  }

  function getTeamServerRequestOptions() {
    if (!teamServer) return undefined;
    return {
      baseUrl: `${teamServer.url}/gemini`,
      customHeaders: { 'x-access-code': teamServer.accessCode }
    };
  }

  // Ollama runs locally without keys; Gemini needs at least one key.
  function isProviderReady() {
    return activeAiProvider === 'ollama' || hasApiKeys();
  }

  function initializeGeminiService(
    apiKey = getActiveApiKey(),
    modelName = activeGeminiModel,
    programmingLanguage = activeProgrammingLanguage
  ) {
    activeGeminiModel = resolveGeminiModel(modelName);
    activeProgrammingLanguage = resolveProgrammingLanguage(programmingLanguage);

    try {
      if (!apiKey) {
        console.error('Gemini API key not configured in app settings');
        geminiService = null;
        return null;
      }

      console.log(
        'Initializing Gemini AI Service with model and language:',
        activeGeminiModel,
        activeProgrammingLanguage
      );

      const requestOptions = apiKey === TEAM_SERVER_KEY ? getTeamServerRequestOptions() : undefined;
      if (geminiService && (requestOptions || geminiService.requestOptions)) {
        // Switching to or from the team server needs a fresh SDK client.
        geminiService = null;
      }

      if (geminiService) {
        geminiService.updateConfiguration({
          apiKey,
          modelName: activeGeminiModel,
          programmingLanguage: activeProgrammingLanguage
        });
      } else {
        geminiService = new GeminiService(apiKey, {
          modelName: activeGeminiModel,
          programmingLanguage: activeProgrammingLanguage,
          requestOptions
        });
      }

      console.log('Gemini AI Service initialized successfully');
      return geminiService;
    } catch (error) {
      geminiService = null;
      console.error('Failed to initialize Gemini AI Service:', error);
      return null;
    }
  }

  function setKeys(apiKeys, preferredIndex = 0) {
    userApiKeys = normalizeGeminiApiKeys(apiKeys);
    geminiApiKeys = getEffectiveApiKeys();

    if (!hasApiKeys()) {
      setActiveApiKeyIndex(0);
      geminiService = null;
      return {
        geminiApiKeys: [],
        activeApiKeyIndex: 0,
        activeApiKey: ''
      };
    }

    setActiveApiKeyIndex(preferredIndex);

    return {
      geminiApiKeys: [...geminiApiKeys],
      activeApiKeyIndex,
      activeApiKey: getActiveApiKey()
    };
  }

  function getApiKeys() {
    return [...geminiApiKeys];
  }

  function switchToNextKey() {
    if (!hasApiKeys()) {
      return {
        switched: false,
        activeApiKeyIndex,
        activeApiKey: ''
      };
    }

    if (geminiApiKeys.length === 1) {
      return {
        switched: false,
        activeApiKeyIndex,
        activeApiKey: getActiveApiKey()
      };
    }

    const previousIndex = activeApiKeyIndex;
    const nextIndex = (activeApiKeyIndex + 1) % geminiApiKeys.length;
    setActiveApiKeyIndex(nextIndex);

    if (nextIndex === previousIndex) {
      return {
        switched: false,
        activeApiKeyIndex,
        activeApiKey: getActiveApiKey()
      };
    }

    initializeGeminiService(getActiveApiKey(), activeGeminiModel, activeProgrammingLanguage);

    return {
      switched: true,
      activeApiKeyIndex,
      activeApiKey: getActiveApiKey()
    };
  }

  function isSwitchEligibleError(error) {
    if (!error) {
      return false;
    }

    if (geminiService?.isQuotaExhaustedError?.(error)) {
      return true;
    }

    if (geminiService?.isAuthenticationError?.(error)) {
      return true;
    }

    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('quota exceeded') ||
      message.includes('api key not valid') ||
      message.includes('invalid api key') ||
      message.includes('permission denied') ||
      message.includes('401') ||
      message.includes('403') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')
    );
  }

  function createAllKeysUnavailableError(cause) {
    const allKeysUnavailableError = new Error(
      'All configured Gemini API keys are currently unavailable due to quota or authentication errors.'
    );

    allKeysUnavailableError.code = GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE;
    allKeysUnavailableError.isAllKeysUnavailable = true;
    if (cause) {
      allKeysUnavailableError.cause = cause;
    }

    return allKeysUnavailableError;
  }

  function isAllKeysUnavailableError(error) {
    return Boolean(
      error && (
        error.code === GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE ||
        error.isAllKeysUnavailable === true
      )
    );
  }

  async function executeWithKeyFailover(operation) {
    if (typeof operation !== 'function') {
      throw new Error('AI failover operation must be a function.');
    }

    // For Ollama, no key failover — just execute directly
    if (activeAiProvider === 'ollama') {
      if (!ollamaService) {
        initializeOllamaService();
      }
      if (!ollamaService) {
        throw new Error('Ollama service not available. Check that Ollama is running.');
      }
      return await operation(ollamaService, {
        activeApiKeyIndex: 0,
        activeApiKey: '',
        attempt: 1,
        totalKeys: 0
      });
    }

    if (!hasApiKeys()) {
      throw new Error('No Gemini API key configured. Add it in Settings.');
    }

    // The team server does its own key failover; surface its errors as-is.
    if (isUsingTeamServer()) {
      if (!geminiService) {
        initializeGeminiService(TEAM_SERVER_KEY, activeGeminiModel, activeProgrammingLanguage);
      }
      return await operation(geminiService, {
        activeApiKeyIndex: 0,
        activeApiKey: '',
        attempt: 1,
        totalKeys: 1
      });
    }

    const totalKeys = geminiApiKeys.length;
    const startIndex = activeApiKeyIndex;
    let attemptedKeys = 0;
    let lastSwitchEligibleError = null;

    while (attemptedKeys < totalKeys) {
      const activeApiKey = getActiveApiKey();
      if (!activeApiKey) {
        break;
      }

      if (!geminiService || geminiService.apiKey !== activeApiKey) {
        initializeGeminiService(activeApiKey, activeGeminiModel, activeProgrammingLanguage);
      }

      try {
        return await operation(geminiService, {
          activeApiKeyIndex,
          activeApiKey,
          attempt: attemptedKeys + 1,
          totalKeys
        });
      } catch (error) {
        if (!isSwitchEligibleError(error)) {
          throw error;
        }

        lastSwitchEligibleError = error;
        attemptedKeys += 1;

        if (attemptedKeys >= totalKeys) {
          if (activeApiKeyIndex !== startIndex) {
            setActiveApiKeyIndex(startIndex);
            initializeGeminiService(getActiveApiKey(), activeGeminiModel, activeProgrammingLanguage);
          }

          throw createAllKeysUnavailableError(lastSwitchEligibleError);
        }

        switchToNextKey();
      }
    }

    throw createAllKeysUnavailableError(lastSwitchEligibleError);
  }

  function initializeOllamaService(
    baseUrl = activeOllamaBaseUrl,
    modelName = activeOllamaModel,
    programmingLanguage = activeProgrammingLanguage
  ) {
    activeOllamaBaseUrl = String(baseUrl || getDefaultOllamaBaseUrl()).replace(/\/+$/, '');
    activeOllamaModel = String(modelName || getDefaultOllamaModel()).trim();
    activeProgrammingLanguage = resolveProgrammingLanguage(programmingLanguage);

    try {
      console.log(
        'Initializing Ollama AI Service with model and language:',
        activeOllamaModel,
        activeProgrammingLanguage
      );

      if (ollamaService) {
        ollamaService.updateConfiguration({
          baseUrl: activeOllamaBaseUrl,
          modelName: activeOllamaModel,
          programmingLanguage: activeProgrammingLanguage
        });
      } else {
        ollamaService = new OllamaService({
          baseUrl: activeOllamaBaseUrl,
          modelName: activeOllamaModel,
          programmingLanguage: activeProgrammingLanguage
        });
      }

      console.log('Ollama AI Service initialized successfully');
      return ollamaService;
    } catch (error) {
      ollamaService = null;
      console.error('Failed to initialize Ollama AI Service:', error);
      return null;
    }
  }

  function initializeAiService() {
    if (activeAiProvider === 'ollama') {
      return initializeOllamaService(activeOllamaBaseUrl, activeOllamaModel, activeProgrammingLanguage);
    }
    return initializeGeminiService(getActiveApiKey(), activeGeminiModel, activeProgrammingLanguage);
  }

  function setActiveAiProvider(providerName) {
    activeAiProvider = resolveAiProvider(providerName);
    return activeAiProvider;
  }

  function getActiveAiProvider() {
    return activeAiProvider;
  }

  function setActiveOllamaBaseUrl(baseUrl) {
    activeOllamaBaseUrl = String(baseUrl || getDefaultOllamaBaseUrl()).replace(/\/+$/, '');
    return activeOllamaBaseUrl;
  }

  function getActiveOllamaBaseUrl() {
    return activeOllamaBaseUrl;
  }

  function setActiveOllamaModel(modelName) {
    activeOllamaModel = String(modelName || getDefaultOllamaModel()).trim();
    return activeOllamaModel;
  }

  function getActiveOllamaModel() {
    return activeOllamaModel;
  }

  function getService() {
    if (activeAiProvider === 'ollama') {
      return ollamaService;
    }
    return geminiService;
  }

  function getActiveGeminiModel() {
    return activeGeminiModel;
  }

  function getActiveProgrammingLanguage() {
    return activeProgrammingLanguage;
  }

  function setActiveGeminiModel(modelName) {
    activeGeminiModel = resolveGeminiModel(modelName);
    return activeGeminiModel;
  }

  function setActiveProgrammingLanguage(language) {
    activeProgrammingLanguage = resolveProgrammingLanguage(language);
    return activeProgrammingLanguage;
  }

  function setActiveKeyIndexChangeHandler(handler) {
    activeKeyIndexChangeHandler = typeof handler === 'function' ? handler : null;
  }

  return {
    initializeGeminiService,
    initializeOllamaService,
    initializeAiService,
    setKeys,
    getApiKeys,
    hasApiKeys,
    isProviderReady,
    isUsingTeamServer,
    setTeamServer,
    getActiveApiKey,
    getActiveApiKeyIndex: () => activeApiKeyIndex,
    switchToNextKey,
    executeWithKeyFailover,
    isAllKeysUnavailableError,
    setActiveKeyIndexChangeHandler,
    getService,
    getAiProviders,
    getDefaultAiProvider,
    getActiveAiProvider,
    setActiveAiProvider,
    getGeminiModels,
    getDefaultGeminiModel,
    getActiveGeminiModel,
    setActiveGeminiModel,
    getDefaultOllamaBaseUrl,
    getDefaultOllamaModel,
    getActiveOllamaBaseUrl,
    setActiveOllamaBaseUrl,
    getActiveOllamaModel,
    setActiveOllamaModel,
    getProgrammingLanguages,
    getDefaultProgrammingLanguage,
    getActiveProgrammingLanguage,
    setActiveProgrammingLanguage
  };
}

module.exports = {
  GEMINI_ALL_KEYS_UNAVAILABLE_ERROR_CODE,
  createGeminiRuntime
};
