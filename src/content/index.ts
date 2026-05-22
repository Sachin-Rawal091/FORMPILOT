import './executor'; // initialize executor
import './recorder'; // initialize recorder

console.log('FormPilot Content Script injected.');

// Note: Message handlers are registered in executor.ts and recorder.ts
// We do NOT add a generic onMessage handler here to avoid
// competing sendResponse calls that would interfere with
// the recorder's and service worker's async message channels.
