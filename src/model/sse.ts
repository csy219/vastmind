// 把 fetch 的响应体按 SSE 规则切成一条条 data 内容。
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const extract = (block: string): string =>
    block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const m = /\r?\n\r?\n/.exec(buf);
        if (!m) break;
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const data = extract(block);
        if (data) yield data;
      }
    }
    const rest = extract(buf + decoder.decode());
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}
