/**
 * @caliper/agent-bridge - Server Stub
 * This module is loaded on Node.js to prevent SSR errors.
 */

export const initAgentBridge = () => {
  // No-op on server
};

export const dispatchCaliperIntent = () => {
  return { error: "Agent bridge is not available on server" };
};

export const getCaliperState = () => {
  return null;
};
