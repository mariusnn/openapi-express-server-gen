import type { ParsedSpec, Operation, Parameter } from './irTypes';

function getParamTsType(p: Parameter): string {
    if (p.schemaRef) return p.schemaRef;
    if (p.primitiveType === 'integer' || p.primitiveType === 'number') return 'number';
    if (p.primitiveType === 'boolean') return 'boolean';
    return 'string';
}

function getReturnType(op: Operation): string {
    if (op.successStatus === null) return 'Promise<{status: number, body: unknown}>';
    const body = op.responseBodySchemaRef ?? 'null';
    return `Promise<{status: ${op.successStatus}, body: ${body}}>`;
}

function buildMethodSignature(op: Operation): string {
    const parts: string[] = [];

    if (op.securitySchemeName) {
        parts.push(`auth: T${op.securitySchemeName}`);
    }

    if (op.parameters.length > 0) {
        const fields = op.parameters.map(p => {
            const opt = p.required ? '' : '?';
            return `${p.name}${opt}: ${getParamTsType(p)}`;
        }).join(', ');
        parts.push(`parameters: { ${fields} }`);
    }

    if (op.requestBodySchemaRef) {
        parts.push(`payload: ${op.requestBodySchemaRef}`);
    }

    return `(${parts.join(', ')}) => ${getReturnType(op)}`;
}

export function generateTypes(spec: ParsedSpec): string {
    const { securitySchemes, operations, specBaseName } = spec;

    const modelTypes = new Set<string>();
    for (const op of operations) {
        if (op.requestBodySchemaRef) modelTypes.add(op.requestBodySchemaRef);
        if (op.responseBodySchemaRef) modelTypes.add(op.responseBodySchemaRef);
        for (const p of op.parameters) {
            if (p.schemaRef) modelTypes.add(p.schemaRef);
        }
    }

    const genericParams = securitySchemes.map(s => `T${s.name}`).join(', ');
    const lines: string[] = [];

    lines.push(`// This file is AUTO-GENERATED from ${specBaseName}. Do not edit manually.`);
    if (securitySchemes.length > 0) {
        lines.push('import { Request } from "express";');
    }
    if (modelTypes.size > 0) {
        lines.push(`import type { ${[...modelTypes].sort().join(', ')} } from "./models";`);
    }
    lines.push('');

    lines.push(`export type AuthHandlers<${genericParams}> = {`);
    for (const scheme of securitySchemes) {
        lines.push(`    ${scheme.name}: (req: Request, scopes: string[]) => Promise<T${scheme.name}>;`);
    }
    lines.push('};');
    lines.push('');

    lines.push(`export type Application<${genericParams}> = {`);
    for (const op of operations) {
        lines.push(`    ${op.operationId}: ${buildMethodSignature(op)};`);
    }
    lines.push('};');
    lines.push('');

    return lines.join('\n');
}
