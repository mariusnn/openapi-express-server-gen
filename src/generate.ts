import * as fs from 'fs';
import * as path from 'path';
import { generate as generateSchemas } from 'openapi-typescript-validator';
import { parseSpec } from './specParser';
import { generateTypes } from './typesGenerator';
import { generateIndex } from './indexGenerator';
import { copyStaticUtils } from './staticCopier';

export interface GenerateOptions {
    schemaFile: string;
    directory: string;
    schemaType?: 'yaml' | 'json';  // auto-detected from extension if omitted
    addFormats?: boolean;           // passed through to openapi-typescript-validator (default: true)
}

function fixDecoderAjvOrder(decodersPath: string): void {
    const original = fs.readFileSync(decodersPath, 'utf8');
    const updated = original.replace(
        /(const ajv = new Ajv\([^)]+\);)\s*(ajv\.compile\([^)]+\);)\s*(addFormats\([^)]+\);)/,
        '$1\n$3\n$2'
    );
    if (original === updated) {
        console.warn('[warn] Expected AJV pattern not found in decoders.ts; no reordering applied.');
    } else {
        fs.writeFileSync(decodersPath, updated, 'utf8');
    }
}

export async function generate(options: GenerateOptions): Promise<void> {
    const specPath = path.resolve(options.schemaFile);
    const outDir = path.resolve(options.directory);

    if (!fs.existsSync(specPath)) {
        throw new Error(`Spec file not found: ${specPath}`);
    }

    // Parse + validate spec BEFORE writing any files
    const spec = parseSpec(specPath);

    // Generate file contents
    const typesContent = generateTypes(spec);
    const indexContent = generateIndex(spec);

    // From here on, files are written
    fs.mkdirSync(outDir, { recursive: true });

    const ext = path.extname(specPath).toLowerCase();
    await generateSchemas({
        schemaFile: specPath,
        schemaType: options.schemaType ?? (ext === '.json' ? 'json' : 'yaml'),
        directory: outDir,
        addFormats: options.addFormats ?? true,
    });

    if (options.addFormats !== false) {
        fixDecoderAjvOrder(path.join(outDir, 'decoders.ts'));
    }

    fs.writeFileSync(path.join(outDir, 'types.ts'), typesContent, 'utf8');
    fs.writeFileSync(path.join(outDir, 'index.ts'), indexContent, 'utf8');

    copyStaticUtils(outDir);
}
