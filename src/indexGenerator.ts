import type { ParsedSpec, Operation, Parameter } from './irTypes';

function getBodyDecoder(op: Operation): string {
    return op.requestBodySchemaRef ? `${op.requestBodySchemaRef}Decoder` : 'EmptyPayloadDecoder';
}

function getParamDecoderExpr(p: Parameter): string {
    if (p.schemaRef) return `${p.schemaRef}Decoder`;
    if (p.primitiveType === 'integer') return 'IntegerDecoder';
    if (p.primitiveType === 'number') return 'NumberDecoder';
    if (p.primitiveType === 'boolean') return 'BooleanDecoder';
    return 'StringDecoder';
}

function getParamDecodersObj(op: Operation): string {
    if (op.parameters.length === 0) return '{}';
    const entries = op.parameters.map(p => {
        const base = getParamDecoderExpr(p);
        const expr = p.required ? base : `Optional(${base})`;
        return `${p.name}: { in: '${p.in}', decoder: ${expr} }`;
    });
    return `{ ${entries.join(', ')} }`;
}

function getHandlerLambda(op: Operation): string {
    const hasBody = op.requestBodySchemaRef !== null;
    const hasParams = op.parameters.length > 0;
    if (hasBody && hasParams) {
        return `(auth, payload, params) => application.${op.operationId}(auth, params, payload)`;
    } else if (hasBody) {
        return `(auth, payload) => application.${op.operationId}(auth, payload)`;
    } else if (hasParams) {
        return `(auth, _payload, params) => application.${op.operationId}(auth, params)`;
    } else {
        return `(auth) => application.${op.operationId}(auth)`;
    }
}

export function generateIndex(spec: ParsedSpec): string {
    const { securitySchemes, operations, specBaseName } = spec;

    // Only emit routes for operations that have a security scheme
    const routableOps = operations.filter(op => op.securitySchemeName !== null);

    const decoderImports = new Set<string>();
    const utilImports = new Set<string>(['handleAuthorizedRequest']);

    for (const op of routableOps) {
        if (op.requestBodySchemaRef) {
            decoderImports.add(`${op.requestBodySchemaRef}Decoder`);
        } else {
            utilImports.add('EmptyPayloadDecoder');
        }

        for (const p of op.parameters) {
            if (p.schemaRef) {
                decoderImports.add(`${p.schemaRef}Decoder`);
            } else {
                if (p.primitiveType === 'integer') utilImports.add('IntegerDecoder');
                else if (p.primitiveType === 'number') utilImports.add('NumberDecoder');
                else if (p.primitiveType === 'boolean') utilImports.add('BooleanDecoder');
                else utilImports.add('StringDecoder');
            }
            if (!p.required) utilImports.add('Optional');
        }
    }

    const genericParams = securitySchemes.map(s => `T${s.name}`).join(', ');
    const lines: string[] = [];

    lines.push(`// This file is AUTO-GENERATED from ${specBaseName}. Do not edit manually.`);
    lines.push(`import type { Express } from 'express';`);
    if (decoderImports.size > 0) {
        lines.push(`import { ${[...decoderImports].sort().join(', ')} } from './decoders';`);
    }
    lines.push(`import { ${[...utilImports].sort().join(', ')} } from './utils/requestHandler';`);
    lines.push(`import { Application, AuthHandlers } from './types';`);
    lines.push('');

    lines.push(`export function registerRoutes<${genericParams}>(`);
    lines.push(`    app: Express,`);
    lines.push(`    authHandler: AuthHandlers<${genericParams}>,`);
    lines.push(`    application: Application<${genericParams}>`);
    lines.push(`): void {`);
    lines.push('');

    for (const op of routableOps) {
        const scopesLiteral = JSON.stringify(op.securityScopes);
        lines.push(`    app.${op.httpMethod}('${op.expressPath}', handleAuthorizedRequest(`);
        lines.push(`        (req) => authHandler.${op.securitySchemeName}(req, ${scopesLiteral}),`);
        lines.push(`        ${getBodyDecoder(op)},`);
        lines.push(`        ${getParamDecodersObj(op)},`);
        lines.push(`        ${getHandlerLambda(op)}`);
        lines.push(`    ));`);
        lines.push('');
    }

    lines.push('}');
    lines.push('');

    return lines.join('\n');
}
