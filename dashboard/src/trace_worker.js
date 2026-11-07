// Project Setu - Off Thread Trace Worker
// Parses large JSONL event streams off the main thread to avoid frame drops.

self.onmessage = function (e) {
  const { id, text } = e.data || {};
  if (typeof text !== 'string') {
    self.postMessage({ id, success: false, error: 'Input must be a string' });
    return;
  }

  try {
    const lines = text.split('\n');
    const events = [];
    const errors = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch (err) {
        errors.push({ line: i + 1, error: err.message });
      }
    }

    self.postMessage({
      id,
      success: true,
      events,
      errorCount: errors.length
    });
  } catch (err) {
    self.postMessage({
      id,
      success: false,
      error: err.message
    });
  }
};

