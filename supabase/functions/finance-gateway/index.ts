// Platform credentials remain inside this function. The scoped app credential is
// validated by the database BEFORE any read/write. Never log request bodies.
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (Number(request.headers.get('content-length') || '0') > 2500000) return new Response('Too large', { status: 413 });
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    if (!reader) return new Response('Missing body', { status: 400 });
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2500000) { await reader.cancel(); return new Response('Too large', { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof payload.server_key !== 'string' || payload.server_key.length !== 64 || !['read', 'write', 'lookup', 'ai_budget', 'pending'].includes(payload.command)) {
      return Response.json({ code: '42501', message: 'Server credential required' }, { status: 403 });
    }
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const response = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/reliefops_finance_command', {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return Response.json({ code: error.code || 'unavailable', message: 'Financial command rejected' }, { status: response.status });
    }
    return new Response(await response.text(), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ code: 'unavailable', message: 'Financial gateway unavailable' }, { status: 503 });
  }
});
