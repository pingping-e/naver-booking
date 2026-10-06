// A classic content script shared with DOM-independent tests.
globalThis.NaverBookingSlots = {
  parseTime(value) {
    const match = value.trim().match(/^(?:(오전|오후)\s*)?(\d{1,2}):([0-5]\d)(?:\s*(?:예약\s*가능|가능|잔여\s*\d+.*))?$/);
    if (!match) return null;
    let hour = Number(match[2]);
    if (match[1]) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (match[1] === '오후' ? 12 : 0);
    } else if (hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:${match[3]}`;
  }
};
