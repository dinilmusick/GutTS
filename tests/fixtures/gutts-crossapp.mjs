// Import the *public auth barrel*, not the new files directly, to prove the real
// package subpath is safe to bundle in both browser and Cloudflare Workers hosts.
import {
  crossAppTierOrder, validateAuthenticatedEndpoint, validateNativePeerForTarget,
  validateRoutedInvocation, evaluateInvocationFailover,
} from '../../dist/auth/index.js';

export const inspectPortableCrossApp = () => ({
  tiers: crossAppTierOrder('desktop'),
  endpointValid: validateAuthenticatedEndpoint('https://example.com/invoke').ok,
  validatorsPresent: typeof validateNativePeerForTarget === 'function'
    && typeof validateRoutedInvocation === 'function'
    && typeof evaluateInvocationFailover === 'function',
});
