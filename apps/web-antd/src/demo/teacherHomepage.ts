import type {
  DemoSite,
  HomepageControls,
  HomepageField,
  HomepagePhoto,
  HomepageRule,
  HomepageSchema,
} from './teacherHomepageData';

import catalogContract from '../../../../contracts/catalog.openapi.json';
import { validates } from '../shared/api/schema';
import { SCHOOL, teachesIn } from './data';
import {
  defaultAllowlist,
  makeDemoControls,
  makeDemoRequests,
  makeDemoSites,
  makePhotoBytes,
  reviewTeachers,
} from './teacherHomepageData';

type WriteSchema =
  | 'TeacherHomepageAllowlistInput'
  | 'TeacherHomepageControlsInput'
  | 'TeacherHomepageDecisionInput'
  | 'TeacherHomepageRequestDecisionInput';
type Allowlist = HomepageSchema['TeacherHomepageAllowlist'];
type FieldValue = HomepageSchema['TeacherHomepageFieldValue'];
type PublicProfile = HomepageSchema['TeacherHomepagePublicProfile'];

interface UploadedPhoto {
  data: string;
  metadata: HomepagePhoto;
}

const schoolPath = /^\/catalog\/admin\/schools\/([^/]+)\/teacher-sites\/(.+)$/;
const photoLimit = 2 * 1024 * 1024;
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const schemas = catalogContract.components.schemas;
const siteIdPattern = /^site-[0-9a-f]{64}$/;
const idPattern = /^[\w.:-]{1,128}$/;

class DemoRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function invalid(): never {
  throw new DemoRequestError('invalid_input', 400);
}

function conflict(): never {
  throw new DemoRequestError('conflict', 409);
}

function missing(): never {
  throw new DemoRequestError('not_found', 404);
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateHeaders });
}

function labelKey(label = '') {
  return label
    .trim()
    .normalize('NFKC')
    .replace(/:+$/, '')
    .trim()
    .replaceAll(/\s+/g, ' ')
    .toLowerCase();
}

function fieldKey(field: HomepageField) {
  return `${field.field}:${labelKey(field.label)}`;
}

function checkUniqueSelectors(
  fields: HomepageField[],
  requireDynamicLabels: boolean,
) {
  const seen = new Set<string>();
  for (const field of fields) {
    const dynamic = field.field === 'fields' || field.field === 'sections';
    const hasLabel = Boolean(labelKey(field.label));
    const key = fieldKey(field);
    if (
      field.field === 'page' ||
      (field.label !== undefined && (!dynamic || !hasLabel)) ||
      (requireDynamicLabels && dynamic && !hasLabel) ||
      seen.has(key)
    )
      invalid();
    seen.add(key);
  }
}

function checkOverride(field: HomepageField, value: FieldValue) {
  if (field.field === 'photo' && value.photo) return;
  if (field.field === 'supervisors' && value.supervisors) {
    if (new Set(value.supervisors).size === value.supervisors.length) return;
    invalid();
  }
  if (field.field === 'fields' && !field.label && value.fields) return;
  if (field.field === 'sections' && !field.label && value.sections) return;
  const textFields = ['photo', 'supervisors', 'fields', 'sections'];
  if (
    value.text?.trim() &&
    (Boolean(field.label) || !textFields.includes(field.field))
  ) {
    const limits: Partial<Record<HomepageField['field'], number>> = {
      name: 256,
      biography: 16_000,
      research: 16_000,
      fields: 1024,
      sections: 16_000,
    };
    if ([...value.text].length <= (limits[field.field] ?? 512)) return;
  }
  invalid();
}

function readBase64(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (character) => character.codePointAt(0)!);
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function validatePhoto(
  photo: HomepageSchema['TeacherHomepagePortraitUpload'],
): Promise<UploadedPhoto> {
  try {
    const bytes = readBase64(photo.data);
    if (bytes.length === 0 || bytes.length > photoLimit) invalid();
    const png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every(
      (byte, index) => bytes[index] === byte,
    );
    const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    if (photo.content_type === 'image/png' ? !png : !jpeg) invalid();
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: photo.content_type }),
    );
    const { height, width } = bitmap;
    bitmap.close();
    if (
      height < 1 ||
      width < 1 ||
      height > 4096 ||
      width > 4096 ||
      height * width > 8_388_608
    )
      invalid();
    const id = await sha256(bytes);
    return {
      data: photo.data,
      metadata: { id, content_type: photo.content_type, height, width },
    };
  } catch {
    return invalid();
  }
}

function page<T>(
  items: T[],
  params: URLSearchParams,
  filter: string,
  revision = 0,
  position?: (item: T) => number,
) {
  const limit = Number(params.get('limit') ?? '20');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid();
  let offset = 0;
  const cursor = params.get('after');
  if (cursor) {
    let value: unknown;
    try {
      value = JSON.parse(cursor);
    } catch {
      return invalid();
    }
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      value[0] !== filter ||
      typeof value[1] !== 'number' ||
      !Number.isSafeInteger(value[1]) ||
      value[1] < 1 ||
      typeof value[2] !== 'number'
    )
      invalid();
    if (value[2] !== revision) conflict();
    offset = value[1];
  }
  const entries = items
    .map((item, index) => ({ item, position: position?.(item) ?? index + 1 }))
    .filter((entry) => entry.position > offset);
  const current = entries.slice(0, limit);
  return {
    items: current.map((entry) => entry.item),
    total: items.length,
    next:
      entries.length > limit
        ? JSON.stringify([filter, current.at(-1)!.position, revision])
        : '',
  };
}

function matchesSearch(needle: string, ...values: (string | undefined)[]) {
  return values.some((value) => value?.toLowerCase().includes(needle));
}

type DynamicGroup = 'fields' | 'sections';
interface DynamicItem {
  label: string;
  text: string;
}

function dynamicItems(
  field: DynamicGroup,
  source: DynamicItem[],
  rules: HomepageRule[],
  allowed: Set<string>,
): DynamicItem[] {
  const group = rules.find(
    (rule) => rule.field.field === field && !rule.field.label,
  );
  if (group?.hidden) return [];
  const groupOverride =
    field === 'fields'
      ? group?.override?.fields?.map((item) => ({
          label: item.label,
          text: item.value,
        }))
      : group?.override?.sections?.map((item) => ({
          label: item.title,
          text: item.text,
        }));
  const customized = new Map(
    rules
      .filter((rule) => rule.field.field === field && rule.field.label)
      .map((rule) => [fieldKey(rule.field), rule]),
  );
  const collected = new Set<string>();
  const result: DynamicItem[] = [];
  for (const item of groupOverride ?? source) {
    const key = fieldKey({ field, label: item.label });
    const rule = customized.get(key);
    if (rule?.hidden) continue;
    if (rule?.override?.text !== undefined) {
      if (!collected.has(key))
        result.push({ label: item.label, text: rule.override.text });
      collected.add(key);
    } else if (groupOverride !== undefined || allowed.has(key)) {
      result.push(item);
    }
  }
  for (const [key, rule] of customized) {
    if (
      !collected.has(key) &&
      !rule.hidden &&
      rule.override?.text &&
      rule.field.label
    ) {
      result.push({ label: rule.field.label, text: rule.override.text });
    }
  }
  return result;
}

function checkCapacity(rules: HomepageRule[]) {
  const empty = new Set<string>();
  if (
    dynamicItems('fields', [], rules, empty).length > 128 ||
    dynamicItems('sections', [], rules, empty).length > 64
  )
    throw new DemoRequestError('teacher_homepage_capacity_exceeded', 409);
}

function addsContent(value: FieldValue | undefined) {
  return Boolean(
    value?.text ||
    value?.photo ||
    value?.fields?.length ||
    value?.sections?.length ||
    value?.supervisors?.length,
  );
}

export class DemoTeacherHomepage {
  private allowlist: Allowlist = { revision: 0, fields: defaultAllowlist };
  private readonly controls = makeDemoControls();
  private effectiveRevision = 1;
  private matchingRevision = 1;
  private readonly photoBytes = makePhotoBytes();
  private readonly receipts = new Map<
    string,
    { fingerprint: string; value: unknown }
  >();
  private readonly requests = makeDemoRequests();
  private readonly sites = makeDemoSites();
  private readonly teacherRevisions = new Map<string, number>();
  private readonly teachingIds = new Set(
    teachesIn.map(([, teacher]) => teacher),
  );
  private readonly uploadedPhotos = new Map<string, UploadedPhoto>();

  async handle(
    path: string,
    params: URLSearchParams,
    method: string,
    init?: RequestInit,
  ): Promise<Response | undefined> {
    try {
      const photo =
        /^\/catalog\/objects\/([^/]+)\/teacher-homepage\/photos\/([^/]+)$/.exec(
          path,
        );
      if (photo && (method === 'GET' || method === 'HEAD')) {
        const [teacherId, photoId] = [
          decodeURIComponent(photo[1]!),
          decodeURIComponent(photo[2]!),
        ];
        return this.teacherPhoto(teacherId, photoId, method === 'HEAD');
      }

      const admin = schoolPath.exec(path);
      if (!admin) return;
      const [, encodedSchool, endpoint] = admin;
      const school = decodeURIComponent(encodedSchool!);
      // The demo session is a fixed administrator with access to one school.
      if (school !== SCHOOL)
        return json({ code: 'forbidden', request_id: 'demo' }, 403);

      if (method === 'GET') return this.read(endpoint!, params);
      if (method === 'PUT') return await this.update(endpoint!, init);
    } catch (error) {
      if (error instanceof URIError)
        return json({ code: 'invalid_input', request_id: 'demo' }, 400);
      if (error instanceof DemoRequestError) {
        return json({ code: error.code, request_id: 'demo' }, error.status);
      }
      throw error;
    }
  }

  hideTarget(
    schoolId: string,
    teacherId: string,
    expectedRevision: number,
  ): 'conflict' | 'not_found' | 'ok' {
    const target = this.target(schoolId, teacherId);
    if (!target) return 'not_found';
    if (target.revision !== expectedRevision || !target.visible)
      return 'conflict';
    const current = this.readControls(teacherId);
    this.controls.set(teacherId, {
      ...current,
      page_visibility: 'hidden',
      revision: current.revision + 1,
    });
    this.changed(teacherId);
    return 'ok';
  }

  target(schoolId: string, teacherId: string) {
    if (
      schoolId !== SCHOOL ||
      !reviewTeachers.some((teacher) => teacher.teacher_id === teacherId)
    )
      return;
    return {
      revision: this.teacherRevisions.get(teacherId) ?? 1,
      visible: Boolean(this.publicProfile(teacherId)),
    };
  }

  private changed(...teacherIds: string[]) {
    this.effectiveRevision++;
    for (const id of teacherIds)
      this.teacherRevisions.set(id, this.effectiveRevision);
  }

  private counts(): HomepageSchema['TeacherHomepageCounts'] {
    const official = new Set(
      this.sites
        .map((site) => this.matchedTeacher(site))
        .filter((id) => id !== undefined),
    );
    const verified = [...this.controls]
      .filter(([, controls]) => controls.independent)
      .map(([id]) => id);
    return {
      teaching: this.teachingIds.size,
      official: official.size,
      both: [...official].filter((id) => this.teachingIds.has(id)).length,
      eligible: new Set([...this.teachingIds, ...official, ...verified]).size,
      verified_homepage: verified.length,
    };
  }

  private decideRequest(
    id: string,
    input: HomepageSchema['TeacherHomepageRequestDecisionInput'],
  ) {
    if (!idPattern.test(id)) invalid();
    const index = this.requests.findIndex((request) => request.id === id);
    const request = this.requests[index] ?? missing();
    const note = input.note.trim();
    if (
      (input.action === 'approve') !==
        (input.expected_homepage_revision !== undefined) ||
      !note
    )
      invalid();
    if (
      input.expected_revision !== request.revision ||
      request.status !== 'pending'
    )
      conflict();
    if (input.action === 'approve') {
      const current = this.readControls(request.teacher_id);
      if (input.expected_homepage_revision !== current.revision) conflict();
      const next: HomepageControls = {
        ...current,
        revision: current.revision + 1,
      };
      if (request.field.field === 'page') {
        if (next.page_visibility !== 'stopped') next.page_visibility = 'hidden';
      } else {
        const key = fieldKey(request.field);
        const rule = current.rules.find((item) => fieldKey(item.field) === key);
        const desired: HomepageRule = {
          field: request.field,
          hidden: request.kind === 'hide' || Boolean(rule?.hidden),
          override: request.kind === 'hide' ? rule?.override : request.value,
        };
        next.rules = rule
          ? current.rules.map((item) => (item === rule ? desired : item))
          : [...current.rules, desired];
      }
      this.setControls(request.teacher_id, {
        ...next,
        independent: current.independent || addsContent(request.value),
      });
    }
    const result = {
      ...request,
      status:
        input.action === 'approve'
          ? ('approved' as const)
          : ('rejected' as const),
      revision: request.revision + 1,
      resolved_at: new Date().toISOString(),
      resolution_note: note,
    };
    this.requests[index] = result;
    return result;
  }

  private decideSite(
    siteId: string,
    input: HomepageSchema['TeacherHomepageDecisionInput'],
  ) {
    if (
      !siteIdPattern.test(siteId) ||
      (input.action === 'bind') !== Boolean(input.teacher_id)
    )
      invalid();
    const site =
      this.sites.find((item) => item.row.site_id === siteId) ?? missing();
    const oldTeacher = this.matchedTeacher(site);
    if (input.expected_revision !== site.row.decision_revision) conflict();
    if (input.action !== 'revoke' && !site.row.present) conflict();
    if (
      site.row.decision?.action === input.action &&
      site.row.decision.teacher_id === input.teacher_id
    ) {
      return {
        site_id: siteId,
        decision_revision: site.row.decision_revision,
        decision: site.row.decision,
      };
    }
    if (input.action === 'bind') {
      if (
        !reviewTeachers.some(
          (teacher) => teacher.teacher_id === input.teacher_id,
        )
      )
        missing();
      if (
        this.sites.some(
          (item) =>
            item !== site && item.row.decision?.teacher_id === input.teacher_id,
        )
      )
        conflict();
      site.row.decision = { action: 'bind', teacher_id: input.teacher_id };
    } else if (input.action === 'reject') {
      site.row.decision = { action: 'reject' };
    } else {
      if (!site.row.decision) conflict();
      delete site.row.decision;
    }
    site.row.decision_revision++;
    this.matchingRevision++;
    const newTeacher = this.matchedTeacher(site);
    this.changed(
      ...[oldTeacher, newTeacher, site.automaticTeacher].filter((id) => id !== undefined),
    );
    return {
      site_id: siteId,
      decision_revision: site.row.decision_revision,
      decision: site.row.decision,
    };
  }

  private matchedTeacher(site: DemoSite) {
    if (!site.row.present) return;
    if (site.row.decision) return site.row.decision.teacher_id;
    const reserved =
      site.automaticTeacher &&
      this.sites.some(
        (item) => item.row.decision?.teacher_id === site.automaticTeacher,
      );
    return reserved ? undefined : site.automaticTeacher;
  }

  private picture(photo: HomepagePhoto, uploaded?: string, head = false) {
    const data = uploaded ?? this.photoBytes.get(photo.id) ?? missing();
    const bytes = readBase64(data);
    return new Response(head ? null : bytes, {
      headers: {
        ...privateHeaders,
        'Content-Type': photo.content_type,
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  private publicProfile(teacherId: string): PublicProfile | undefined {
    const controls = this.readControls(teacherId);
    const source = this.sourceFor(teacherId);
    if (
      controls.page_visibility !== 'visible' ||
      (!source && !controls.independent)
    )
      return;
    const allowed = new Set(
      this.allowlist.fields.map((field) => fieldKey(field)),
    );
    const profile: PublicProfile = {
      supervisors: [],
      fields: [],
      sections: [],
    };
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value === 'string' && allowed.has(`${key}:`))
        Object.assign(profile, { [key]: value });
    }
    if (allowed.has('supervisors:') && source)
      profile.supervisors = source.supervisors;
    for (const rule of controls.rules) {
      const field = rule.field.field;
      if (field === 'fields' || field === 'sections') continue;
      if (rule.hidden) {
        if (field === 'supervisors') profile.supervisors = [];
        else Reflect.deleteProperty(profile, field);
      } else if (rule.override?.text) {
        Object.assign(profile, { [field]: rule.override.text });
      } else if (rule.override?.supervisors) {
        profile.supervisors = rule.override.supervisors;
      } else if (rule.override?.photo) {
        const { id, ...photo } = rule.override.photo;
        profile.photo = {
          ...photo,
          url: `/api/v1/catalog/objects/${encodeURIComponent(teacherId)}/teacher-homepage/photos/${id}`,
        };
      }
    }
    const fields = (source?.fields ?? []).map((item) => ({
      label: item.label,
      text: item.value,
    }));
    const sections = (source?.sections ?? []).map((item) => ({
      label: item.title,
      text: item.text,
    }));
    profile.fields = dynamicItems('fields', fields, controls.rules, allowed)
      .slice(0, 128)
      .map(({ label, text }) => ({ label, value: text }));
    profile.sections = dynamicItems(
      'sections',
      sections,
      controls.rules,
      allowed,
    )
      .slice(0, 64)
      .map(({ label, text }) => ({ title: label, text }));
    return Object.values(profile).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    )
      ? profile
      : undefined;
  }

  private read(endpoint: string, params: URLSearchParams) {
    switch (endpoint) {
      case 'allowlist': {
        return json(this.allowlist);
      }
      case 'homepage-counts': {
        return json(this.counts());
      }
      case 'requests': {
        return json(this.requestList(params));
      }
      case 'review/sites': {
        return json(this.siteList(params));
      }
      case 'review/teachers': {
        return json(this.teacherList(params));
      }
    }
    const profile = /^teachers\/([^/]+)\/homepage$/.exec(endpoint);
    if (profile) {
      const teacherId = decodeURIComponent(profile[1]!);
      return json({
        source: this.sourceFor(teacherId),
        controls: this.readControls(teacherId),
      });
    }
    const application = /^requests\/([^/]+)(\/photo)?$/.exec(endpoint);
    if (application) {
      const id = decodeURIComponent(application[1]!);
      if (!idPattern.test(id)) invalid();
      const request = this.requests.find((row) => row.id === id) ?? missing();
      if (application[2])
        return this.picture(request.value?.photo ?? missing());
      return json(request);
    }
  }

  private readControls(teacherId: string): HomepageControls {
    if (!idPattern.test(teacherId)) invalid();
    if (!reviewTeachers.some((teacher) => teacher.teacher_id === teacherId))
      missing();
    return (
      this.controls.get(teacherId) ?? {
        revision: 0,
        page_visibility: 'visible',
        independent: false,
        rules: [],
      }
    );
  }

  private requestList(params: URLSearchParams) {
    const status = params.get('status') ?? 'pending';
    const teacherId = params.get('teacher_id');
    if (
      !['all', 'approved', 'pending', 'rejected'].includes(status) ||
      (teacherId && !idPattern.test(teacherId))
    )
      invalid();
    const requests = this.requests.filter(
      (request) =>
        (status === 'all' || request.status === status) &&
        (!teacherId || request.teacher_id === teacherId),
    );
    return page(
      requests,
      params,
      JSON.stringify(['requests', status, teacherId]),
      0,
      (request) => this.requests.indexOf(request) + 1,
    );
  }

  private saveControls(
    teacherId: string,
    input: HomepageSchema['TeacherHomepageControlsInput'],
    uploaded: undefined | UploadedPhoto,
  ) {
    const current = this.readControls(teacherId);
    if (input.expected_revision !== current.revision) conflict();
    checkUniqueSelectors(
      input.rules.map((rule) => rule.field),
      false,
    );
    const rules = input.rules.map(({ override, ...rule }): HomepageRule => {
      if (!override) {
        if (!rule.hidden) invalid();
        return rule;
      }
      const { photo, ...values } = override;
      let value: FieldValue = values;
      if (photo) {
        const previous = current.rules.find(
          (item) => item.field.field === 'photo',
        )?.override?.photo;
        if ('id' in photo && photo.id === previous?.id)
          value = { photo: previous };
        else if ('data' in photo && uploaded)
          value = { photo: uploaded.metadata };
        else invalid();
      }
      checkOverride(rule.field, value);
      return { ...rule, override: value };
    });
    const revision = current.revision + 1;
    this.setControls(teacherId, {
      ...current,
      revision,
      page_visibility: input.page_visibility,
      rules,
    });
    if (uploaded) this.uploadedPhotos.set(teacherId, uploaded);
    if (!rules.some((rule) => rule.override?.photo))
      this.uploadedPhotos.delete(teacherId);
    return { teacher_id: teacherId, revision };
  }

  private setControls(teacherId: string, controls: HomepageControls) {
    if (
      new TextEncoder().encode(JSON.stringify(controls)).byteLength >
      1024 * 1024
    )
      invalid();
    checkCapacity(controls.rules);
    this.controls.set(teacherId, controls);
    this.changed(teacherId);
  }

  private siteList(params: URLSearchParams) {
    const status = params.get('status') ?? 'pending';
    const query = (params.get('q') ?? '').trim().toLowerCase();
    if (
      !['all', 'decided', 'pending'].includes(status) ||
      [...query].length > 200
    )
      invalid();
    const items = this.sites.flatMap((site) => {
      const { row } = site;
      const matched = this.matchedTeacher(site);
      if (
        (!row.present && !row.decision) ||
        (status === 'pending' && (matched || row.decision)) ||
        (status === 'decided' && !row.decision) ||
        !matchesSearch(query, row.name, row.unit, row.site_id)
      )
        return [];
      const result = { ...row };
      if (matched) {
        result.matched_teacher_id = matched;
        delete result.reason;
      } else if (row.present && row.decision) {
        delete result.reason;
      } else if (site.automaticTeacher && row.present) {
        result.reason = 'manual_conflict';
      }
      return [result];
    });
    return page(
      items,
      params,
      JSON.stringify(['sites', status, query]),
      this.matchingRevision,
    );
  }

  private sourceFor(teacherId: string) {
    return this.sites.find((site) => this.matchedTeacher(site) === teacherId)
      ?.source;
  }

  private teacherList(params: URLSearchParams) {
    const status = params.get('status') ?? 'unmatched';
    const query = (params.get('q') ?? '').trim().toLowerCase();
    if (!['all', 'unmatched'].includes(status) || [...query].length > 200)
      invalid();
    const items = reviewTeachers
      .toSorted((a, b) => a.teacher_id.localeCompare(b.teacher_id))
      .flatMap((teacher) => {
        const matched = this.sites.find(
          (site) => this.matchedTeacher(site) === teacher.teacher_id,
        );
        if (
          (status === 'unmatched' && matched) ||
          !matchesSearch(
            query,
            teacher.name,
            teacher.department,
            teacher.teacher_id,
          )
        )
          return [];
        const candidates = this.sites
          .filter(
            (site) =>
              site.row.present &&
              site.row.candidates.some(
                (item) => item.teacher_id === teacher.teacher_id,
              ),
          )
          .map(({ row: { name, present, site_id, unit } }) => ({
            name,
            present,
            site_id,
            unit,
          }));
        return [
          {
            ...teacher,
            ...(matched
              ? { matched_site_id: matched.row.site_id }
              : {
                  reason:
                    candidates.length === 0 ? 'name_absent' : 'unit_mismatch',
                }),
            candidates,
            candidate_count: candidates.length,
          },
        ];
      });
    return page(
      items,
      params,
      JSON.stringify(['teachers', status, query]),
      this.matchingRevision,
    );
  }

  private teacherPhoto(teacherId: string, photoId: string, head: boolean) {
    if (!/^[0-9a-f]{64}$/.test(photoId)) invalid();
    const profile = this.publicProfile(teacherId);
    const override = this.readControls(teacherId).rules.find(
      (rule) => rule.field.field === 'photo',
    );
    const photo = override?.override?.photo;
    if (!profile?.photo || photo?.id !== photoId) missing();
    const uploaded = this.uploadedPhotos.get(teacherId);
    return this.picture(
      photo,
      uploaded?.metadata.id === photoId ? uploaded.data : undefined,
      head,
    );
  }

  private async update(endpoint: string, init?: RequestInit) {
    if (endpoint === 'allowlist') {
      return this.write(
        'TeacherHomepageAllowlistInput',
        endpoint,
        init,
        (input) => {
          checkUniqueSelectors(input.fields, true);
          if (input.expected_revision !== this.allowlist.revision) conflict();
          this.allowlist = {
            revision: input.expected_revision + 1,
            fields: input.fields.map((field) =>
              field.label ? { ...field, label: field.label.trim() } : field,
            ),
          };
          this.changed(...reviewTeachers.map((teacher) => teacher.teacher_id));
          return this.allowlist;
        },
      );
    }
    const site = /^review\/sites\/([^/]+)\/decision$/.exec(endpoint);
    if (site) {
      const siteId = decodeURIComponent(site[1]!);
      return this.write('TeacherHomepageDecisionInput', siteId, init, (input) =>
        this.decideSite(siteId, input),
      );
    }
    const profile = /^teachers\/([^/]+)\/homepage$/.exec(endpoint);
    if (profile) {
      const teacherId = decodeURIComponent(profile[1]!);
      let uploaded: undefined | UploadedPhoto;
      return this.write(
        'TeacherHomepageControlsInput',
        teacherId,
        init,
        (input) => this.saveControls(teacherId, input, uploaded),
        async (input) => {
          const photo = input.rules.find((rule) => rule.field.field === 'photo')
            ?.override?.photo;
          if (photo && 'data' in photo) uploaded = await validatePhoto(photo);
        },
      );
    }
    const application = /^requests\/([^/]+)\/decision$/.exec(endpoint);
    if (application) {
      const id = decodeURIComponent(application[1]!);
      return this.write(
        'TeacherHomepageRequestDecisionInput',
        id,
        init,
        (input) => this.decideRequest(id, input),
      );
    }
  }

  private async write<Name extends WriteSchema>(
    schema: Name,
    target: string,
    init: RequestInit | undefined,
    apply: (input: HomepageSchema[Name]) => unknown,
    prepare?: (input: HomepageSchema[Name]) => Promise<void>,
  ) {
    const key = new Headers(init?.headers).get('Idempotency-Key') ?? '';
    if (!/^[ -~]{1,128}$/.test(key)) invalid();
    const raw = typeof init?.body === 'string' ? init.body : '';
    const bytes = new TextEncoder().encode(raw);
    if (bytes.byteLength > 4 * 1024 * 1024) {
      throw new DemoRequestError('payload_too_large', 413);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return invalid();
    }
    if (!validates(value, schemas[schema], schemas)) invalid();
    // The payload was checked against the schema corresponding to Name.
    const input = value as HomepageSchema[Name];
    // Keep large avatar payloads out of the replay receipts.
    const fingerprint = JSON.stringify([
      target,
      bytes.byteLength > 65_536 ? await sha256(bytes) : input,
    ]);
    const receiptKey = `${schema}:${key}`;
    const readReplay = () => {
      const prior = this.receipts.get(receiptKey);
      if (prior && prior.fingerprint !== fingerprint) conflict();
      return prior;
    };
    if (prepare && !readReplay()) await prepare(input);
    const replay = readReplay();
    if (replay) return json(replay.value);
    const result = apply(input);
    this.receipts.set(receiptKey, { fingerprint, value: result });
    return json(result);
  }
}

const demo = new DemoTeacherHomepage();

export const handleDemoTeacherHomepage = (
  path: string,
  params: URLSearchParams,
  method: string,
  init?: RequestInit,
) => demo.handle(path, params, method, init);

export const readDemoTeacherHomepageTarget = (
  schoolId: string,
  teacherId: string,
) => demo.target(schoolId, teacherId);

export const hideDemoTeacherHomepageTarget = (
  schoolId: string,
  teacherId: string,
  expectedRevision: number,
) => demo.hideTarget(schoolId, teacherId, expectedRevision);
