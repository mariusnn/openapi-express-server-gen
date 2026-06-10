import * as fs from 'fs';
import * as path from 'path';

export function copyStaticUtils(outDir: string): void {
    const src = path.join(__dirname, 'static', 'utils');
    const dst = path.join(outDir, 'utils');
    fs.mkdirSync(dst, { recursive: true });
    for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, file), path.join(dst, file));
    }
}
