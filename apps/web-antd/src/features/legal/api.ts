import type { components } from '#/api/legal.gen';
import type { Http, RequestOptions } from '#/shared/api/http';

import { ApiError } from '#/shared/api/errors';
import { segment } from '#/shared/api/http';
import { schemaOf, validates } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/legal.openapi.json';

type Schemas = components['schemas'];

export type AdminDocument = Schemas['AdminDocument'];
export type AdminDocumentMetadata = Schemas['AdminDocumentMetadata'];
export type AdminDocumentPage = Schemas['AdminDocumentPage'];
export type CreateDraft = Schemas['CreateDraft'];
export type CreateVariable = Schemas['CreateVariable'];
export type DraftContent = Schemas['DraftContent'];
export type Preview = Schemas['Preview'];
export type PublicDocument = Schemas['PublicDocument'];
export type ValidationIssue = Schemas['ValidationIssue'];
export type Variable = Schemas['Variable'];
export type VariableContent = Schemas['VariableContent'];
export type VariablePage = Schemas['VariablePage'];

const { parameters, schemas } = contract.components;
const parse = {
  current: schemaOf<PublicDocument>(schemas, 'PublicDocument'),
  document: schemaOf<AdminDocument>(schemas, 'AdminDocument'),
  documents: schemaOf<AdminDocumentPage>(schemas, 'AdminDocumentPage'),
  preview: schemaOf<Preview>(schemas, 'Preview'),
  variable: schemaOf<Variable>(schemas, 'Variable'),
  variables: schemaOf<VariablePage>(schemas, 'VariablePage'),
};

const documentsPath = '/api/v1/admin/legal/documents';
const variablesPath = '/api/v1/admin/legal/variables';

function checkInput(input: unknown, schema: unknown) {
  if (!validates(input, schema, schemas)) throw new ApiError('invalid_input');
}

function pathSegment(value: string, name: 'Slug' | 'VariableKey' | 'Version') {
  checkInput(value, parameters[name].schema);
  return segment(value);
}

const versionsPath = (slug: string) =>
  `${documentsPath}/${pathSegment(slug, 'Slug')}/versions`;
const versionPath = (slug: string, version: string) =>
  `${versionsPath(slug)}/${pathSegment(version, 'Version')}`;
const variablePath = (key: string) =>
  `${variablesPath}/${pathSegment(key, 'VariableKey')}`;

function pageOptions(offset: number, limit: number, signal?: AbortSignal) {
  checkInput(offset, parameters.Offset.schema);
  checkInput(limit, parameters.Limit.schema);
  return { query: { limit, offset }, signal };
}

function writeOptions(
  method: 'DELETE' | 'POST' | 'PUT',
  key: string,
): RequestOptions {
  checkInput(key, parameters.IdempotencyKey.schema);
  return { method, key };
}

function revisionOptions(
  method: 'DELETE' | 'POST' | 'PUT',
  key: string,
  revision: number,
): RequestOptions {
  // If-Match carries a quoted decimal. Refuse imprecise JavaScript numbers.
  checkInput(revision, schemas.AdminDocument.properties.revision);
  return {
    ...writeOptions(method, key),
    headers: { 'If-Match': `"${revision}"` },
  };
}

export function validationIssues(error: unknown): ValidationIssue[] {
  if (
    !(error instanceof ApiError) ||
    error.status !== 422 ||
    error.code !== 'validation_failed' ||
    !validates(error.detail, schemas.Error, schemas)
  ) {
    return [];
  }
  // The error payload matched the same schema as the generated type.
  return (error.detail as Schemas['Error']).issues ?? [];
}

export class LegalApi {
  constructor(private readonly http: Http) {}

  archiveVersion(slug: string, version: string, revision: number, key: string) {
    return this.http.json(
      `${versionPath(slug, version)}/archive`,
      parse.document,
      revisionOptions('POST', key, revision),
    );
  }

  createDraft(slug: string, body: CreateDraft, key: string) {
    checkInput(body, schemas.CreateDraft);
    return this.http.json(versionsPath(slug), parse.document, {
      ...writeOptions('POST', key),
      body,
    });
  }

  createVariable(body: CreateVariable, key: string) {
    checkInput(body, schemas.CreateVariable);
    return this.http.json(variablesPath, parse.variable, {
      ...writeOptions('POST', key),
      body,
    });
  }

  deleteDraft(slug: string, version: string, revision: number, key: string) {
    return this.remove(versionPath(slug, version), revision, key);
  }

  deleteVariable(variable: string, revision: number, key: string) {
    return this.remove(variablePath(variable), revision, key);
  }

  getCurrentDocument(slug: string, signal?: AbortSignal) {
    return this.http.json(
      `/api/v1/legal/documents/${pathSegment(slug, 'Slug')}`,
      parse.current,
      { signal },
    );
  }

  getVariable(key: string, signal?: AbortSignal) {
    return this.http.json(variablePath(key), parse.variable, { signal });
  }

  getVersion(slug: string, version: string, signal?: AbortSignal) {
    return this.http.json(versionPath(slug, version), parse.document, {
      signal,
    });
  }

  listDocuments(offset = 0, signal?: AbortSignal, limit = 20) {
    return this.http.json(
      documentsPath,
      parse.documents,
      pageOptions(offset, limit, signal),
    );
  }

  listVariables(offset = 0, signal?: AbortSignal, limit = 20) {
    return this.http.json(
      variablesPath,
      parse.variables,
      pageOptions(offset, limit, signal),
    );
  }

  listVersions(slug: string, offset = 0, signal?: AbortSignal, limit = 20) {
    return this.http.json(
      versionsPath(slug),
      parse.documents,
      pageOptions(offset, limit, signal),
    );
  }

  async previewVersion(
    slug: string,
    version: string,
    body?: DraftContent,
    signal?: AbortSignal,
  ) {
    if (body !== undefined) checkInput(body, schemas.DraftContent);
    try {
      return await this.http.json(
        `${versionPath(slug, version)}/preview`,
        parse.preview,
        {
          method: 'POST',
          body,
          signal,
        },
      );
    } catch (error) {
      // The preview POST renders without changing the document.
      if (error instanceof ApiError && error.uncertain) {
        throw new ApiError(
          error.code,
          false,
          error.status,
          error.operationId,
          error.detail,
        );
      }
      throw error;
    }
  }

  publishVersion(slug: string, version: string, revision: number, key: string) {
    return this.http.json(
      `${versionPath(slug, version)}/publish`,
      parse.document,
      revisionOptions('POST', key, revision),
    );
  }

  updateDraft(
    slug: string,
    version: string,
    revision: number,
    body: DraftContent,
    key: string,
  ) {
    checkInput(body, schemas.DraftContent);
    return this.http.json(versionPath(slug, version), parse.document, {
      ...revisionOptions('PUT', key, revision),
      body,
    });
  }

  updateVariable(
    variable: string,
    revision: number,
    body: VariableContent,
    key: string,
  ) {
    checkInput(body, schemas.VariableContent);
    return this.http.json(variablePath(variable), parse.variable, {
      ...revisionOptions('PUT', key, revision),
      body,
    });
  }

  private async remove(
    path: string,
    revision: number,
    key: string,
  ): Promise<true> {
    const response = await this.http.send(
      path,
      revisionOptions('DELETE', key, revision),
    );
    if (response.status !== 204)
      throw new ApiError('incompatible', true, response.status);
    return true;
  }
}

export function useLegalApi() {
  return new LegalApi(useHttp());
}
