#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { generate } from './generate';

function parseArgv(): { spec: string; out: string } {
    const args = process.argv.slice(2);
    let spec = '';
    let out = '';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--spec' && args[i + 1]) spec = args[++i];
        else if (args[i] === '--out' && args[i + 1]) out = args[++i];
    }
    return { spec, out };
}

function loadConfig(): { spec?: string; out?: string } {
    const cwd = process.cwd();
    const configPath = path.join(cwd, 'openapi-server-gen.config.json');
    if (fs.existsSync(configPath)) {
        try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* ignore */ }
    }
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg['openapi-server-gen']) return pkg['openapi-server-gen'];
        } catch { /* ignore */ }
    }
    return {};
}

async function main(): Promise<void> {
    const argv = parseArgv();
    const config = loadConfig();
    const cwd = process.cwd();

    const specArg = argv.spec || config.spec || './openapi.yaml';
    const outArg = argv.out || config.out || './src/_generated/server';

    try {
        await generate({
            schemaFile: path.resolve(cwd, specArg),
            directory: path.resolve(cwd, outArg),
        });
        console.log(`Generated server files into ${path.resolve(cwd, outArg)}`);
    } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
