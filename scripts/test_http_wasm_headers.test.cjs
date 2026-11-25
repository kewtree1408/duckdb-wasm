const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../lib/src/http_wasm.cc'), 'utf8');
// Exercise the embedded JavaScript without rebuilding the Wasm binaries.
const requests = [...source.matchAll(
    /unique_ptr<HTTPResponse> (Get|Head|Post|Put|Delete)\([\s\S]*?EM_ASM_PTR\(\s*\{\s*([\s\S]*?)^            },/gm,
)];
assert.equal(requests.length, 5);

for (const [, method, body] of requests) {
    test(`${method} leaves Host to the browser and forwards it only for the configured proxy`, () => {
        const loop = body.match(/var i = 0;[\s\S]*?^                }/m);
        assert.ok(loop, 'Expected the request header loop');
        const code = body.slice(0, loop.index + loop[0].length);
        const proxy = 'https://proxy.example/';
        const cases = [
            { url: 'https://catalog.example/table', proxy: '', override: false },
            { url: 'https://catalog.example/table', proxy, override: false },
            { url: `${proxy}catalog.example/table`, proxy, override: true },
        ];
        for (const name of ['host', 'Host', 'hOsT']) {
            for (const scenario of cases) {
                const label = `${name}, ${scenario.url}, proxy=${scenario.proxy}`;
                const headers = [
                    [name, 'catalog.example'],
                    ['Authorization', 'AWS4-HMAC-SHA256 Credential=fixture, SignedHeaders=host;x-amz-date, Signature=fixture'],
                    ['x-amz-date', '20261123T120000Z'],
                    ['x-amz-security-token', 'fixture/token+value='],
                ];
                const strings = new Map([[4, scenario.url], [8, method.toUpperCase()], [12, scenario.proxy]]);
                const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
                const heap = new Int32Array(memory.buffer);
                headers.flat().forEach((value, index) => {
                    const pointer = 32 + index * 16;
                    strings.set(pointer, value);
                    heap[64 + index] = pointer;
                });
                const sent = new Map();
                const warnings = [];
                vm.runInNewContext(`(() => { ${code} })()`, {
                    $0: 4, $1: headers.length, $2: 256, $3: 8,
                    $4: method === 'Post' || method === 'Put' ? 0 : 12, $6: 12,
                    wasmMemory: memory,
                    UTF8ToString: pointer => strings.get(pointer),
                    XMLHttpRequest: function () {
                        this.open = () => {};
                        this.setRequestHeader = (header, value) => sent.set(header.toLowerCase(), value);
                    },
                    console: { warn: (...args) => warnings.push(args) },
                });
                assert.equal(sent.has('host'), false, label);
                assert.equal(sent.get('x-host-override'), scenario.override ? 'catalog.example' : undefined, label);
                for (const [header, value] of headers.slice(1)) {
                    assert.equal(sent.get(header.toLowerCase()), value, label);
                }
                assert.equal(sent.size, headers.length - 1 + Number(scenario.override), label);
                assert.deepEqual(warnings, [], label);
            }
        }
    });
}
