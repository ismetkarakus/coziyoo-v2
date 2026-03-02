const DEVICE_KEY = "coziyoo_agent_device_id";

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `agent-${crypto.randomUUID()}`;
  }
  return `agent-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const next = createId();
  localStorage.setItem(DEVICE_KEY, next);
  return next;
}
