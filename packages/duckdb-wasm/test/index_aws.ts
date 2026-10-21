import * as duckdb from '../src/';

describe('loadable AWS (base)', () => {
    it('loads and exposes AWS settings and functions', async () => {
        const worker = new Worker('/static/duckdb-browser-base.worker.js');
        const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
        let stage = 'instantiate';
        let timer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                worker.terminate();
                reject(new Error(`AWS base timed out during ${stage}`));
            }, 90000);
        });
        const run = async () => {
            await db.instantiate('/static/duckdb-base.wasm');
            await db.open({
                allowUnsignedExtensions: true,
                extensionRepository: new URL('/extensions', location.href).href,
            });
            const conn = await db.connect();
            const query = async (sql: string) => {
                stage = sql;
                return conn.query(sql);
            };
            const scalar = async (sql: string) => (await query(sql)).getChildAt(0)!.get(0);

            expect(
                await scalar("SELECT count(*) FROM duckdb_extensions() WHERE extension_name='aws' AND loaded"),
            ).toEqual(0n);
            await query('INSTALL AND LOAD aws');
            expect(
                await scalar("SELECT count(*) FROM duckdb_extensions() WHERE extension_name='aws' AND loaded"),
            ).toEqual(1n);
            expect(await scalar("SELECT current_setting('aws_network_calls_via_duckdb')")).toEqual(true);
            expect(await scalar('SELECT length(duckdb_aws_session_id()) > 0')).toEqual(true);
            expect(await scalar('SELECT duckdb_aws_session_id() = duckdb_aws_session_id()')).toEqual(true);
            // The first s3 lookup also resolves the default credential chain. In a browser that must stop at
            // the local providers: probing the EC2 metadata endpoint blocks the worker on a synchronous XHR.
            await query('INSTALL AND LOAD httpfs');
            await query(
                "CREATE OR REPLACE TEMPORARY SECRET aws_wasm_test (TYPE s3, PROVIDER config, KEY_ID 'dummy', " +
                    "SECRET 'dummy', REGION 'eu-central-1', SCOPE 's3://bucket/prefix/')",
            );
            expect(await scalar("SELECT name FROM which_secret('s3://bucket/prefix/key', 's3')")).toEqual(
                'aws_wasm_test',
            );
            expect(await scalar("SELECT name FROM which_secret('s3://bucket/key', 's3')")).toEqual('__aws_default_s3');
            await expectAsync(
                query("CREATE TEMPORARY SECRET chain_instance (TYPE s3, PROVIDER credential_chain, CHAIN 'instance')"),
            ).toBeRejectedWithError(/not available under WebAssembly/);
            await conn.close();
        };
        try {
            await Promise.race([run(), deadline]);
        } finally {
            clearTimeout(timer!);
            await db.terminate();
        }
    }, 100000);
});
