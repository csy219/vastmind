import { describe, expect, it } from 'vitest';
import { sseData } from '../src/model/sse.js';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(x));
      c.close();
    },
  });
}
const collect = async (s: ReadableStream<Uint8Array>) => {
  const out: string[] = [];
  for await (const d of sseData(s)) out.push(d);
  return out;
};

describe('sseData', () => {
  it('把被切断的分片重新拼成完整事件', async () => {
    const enc = new TextEncoder();
    const s = streamOf([enc.encode('data: {"a"'), enc.encode(':1}\n\ndata: [DO'), enc.encode('NE]\n\n')]);
    expect(await collect(s)).toEqual(['{"a":1}', '[DONE]']);
  });

  it('一个汉字被切成两半也不乱码', async () => {
    const bytes = new TextEncoder().encode('data: 你好\n\n');
    const s = streamOf([bytes.slice(0, 8), bytes.slice(8)]); // 在“你”的中间切开
    expect(await collect(s)).toEqual(['你好']);
  });

  it('流结束时没有空行结尾的最后一条也会产出', async () => {
    const s = streamOf([new TextEncoder().encode('data: tail')]);
    expect(await collect(s)).toEqual(['tail']);
  });

  it('兼容 CRLF 换行', async () => {
    const s = streamOf([new TextEncoder().encode('data: x\r\n\r\ndata: y\r\n\r\n')]);
    expect(await collect(s)).toEqual(['x', 'y']);
  });
});
