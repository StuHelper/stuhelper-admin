import type { components } from '../api/catalog.gen';

import { ago, departments, teachers } from './data';

export type HomepageSchema = components['schemas'];
export type HomepageControls = HomepageSchema['TeacherHomepageControls'];
export type HomepageField = HomepageSchema['TeacherHomepageFieldSelector'];
export type HomepagePhoto = HomepageSchema['TeacherHomepagePortrait'];
export type HomepageRequest = HomepageSchema['TeacherHomepageRequest'];
export type HomepageRule = HomepageSchema['TeacherHomepageFieldRule'];
export type HomepageSite = HomepageSchema['TeacherHomepageReviewSite'];
export type HomepageSource = HomepageSchema['TeacherHomepage'];
export type HomepageTeacher =
  HomepageSchema['TeacherHomepageReviewTeacherSummary'];

// Drawn placeholders for fictional teachers and requests in the offline demo.
export const sourcePortrait = {
  id: '8909d375d86b9c19b07a9aa215317f78249c004c4f793703f8944726e3077ca3',
  content_type: 'image/png',
  width: 64,
  height: 64,
} satisfies HomepagePhoto;
export const requestPortrait = {
  id: 'c8581c4f14910a4cbb898006d1c5a7ddbceabb6a30bd5ae0268d652722503d73',
  content_type: 'image/png',
  width: 64,
  height: 64,
} satisfies HomepagePhoto;

export const makePhotoBytes = () =>
  new Map([
    [
      requestPortrait.id,
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAqUlEQVR42u3Yuw2AMAwAUS/DQIzCwkxASw8LhMJ28CcneYB7ApEYOe+r9AgAAAAAAAAAAAAAAMPZjr0e4I0eTXbAR/okhvxf72uQkHpHAwBtvZcBAIB4gLrexcATAACAk7gJoPxttMM+0GEja7IT81uFV2jqhygvoPA5wEITBzDW2w0SXm80SIZ6i2FVgHu92rAkYFK9zgAAAIBM9QoDGxkAAAAAAAAQOQ8GmqybcvPg0gAAAABJRU5ErkJggg==',
    ],
    [
      sourcePortrait.id,
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAqElEQVR42u3YWw2AMAxA0epBGNqwhQEsAAbGR9vRx25SAfcEwlbkvO7SIwAAAAAAAAAAAAAADGfbj3qAN3o02QEf6ZMY8n+9r0FC6h0NALT1XgYAAOIB6noXA08AAABO4iaA8rfRDvtAh42syU7MbxVeoakforyAwucAC00cwFhvN0h4vdEgGeothlUB7vVqw5KASfU6AwAAADLVKwxsZAAAAAAAAEDkPLaPWXHg0v8bAAAAAElFTkSuQmCC',
    ],
  ]);

export const reviewTeachers: HomepageTeacher[] = teachers.map((teacher) => {
  const department = departments.find(
    (item) => 'department_id' in teacher && item.id === teacher.department_id,
  );
  return {
    teacher_id: teacher.id,
    name: teacher.name,
    ...(department && {
      department_id: department.id,
      department: department.name,
    }),
    title: teacher.id === 'p1' ? '教授' : '副教授',
  };
});

export interface DemoSite {
  row: HomepageSite;
  automaticTeacher?: string;
  source?: HomepageSource;
}

function site(
  id: string,
  name: string,
  unit: string,
  candidateId?: string,
  options: {
    automaticTeacher?: string;
    reason?: string;
    research?: string;
  } = {},
): DemoSite {
  const candidates = reviewTeachers.filter(
    (teacher) => teacher.teacher_id === candidateId,
  );
  const research = options.research ?? '高等教育与教学方法';
  const biography = '教师主页演示资料，含研究方向、教学工作与学术活动。';
  return {
    automaticTeacher: options.automaticTeacher,
    row: {
      site_id: `site-${id.repeat(64)}`,
      name,
      unit,
      present: true,
      ...(options.reason && { reason: options.reason }),
      biography_excerpt: biography,
      discipline: unit || '教师教育',
      candidate_count: candidates.length,
      candidates,
      decision_revision: 0,
    },
    source: {
      name,
      position: '教研室成员',
      discipline: unit || '教师教育',
      biography,
      research,
      supervisors: ['硕士生导师'],
      fields: [
        { label: '学术活动', value: '院系研究生讨论班' },
        { label: '实验室', value: '校内联合实验室' },
      ],
      sections: [
        { title: '教学工作', text: '讲授本专业基础课并组织学术交流。' },
        { title: '科研项目', text: '参与跨学科教学与科研项目。' },
      ],
    },
  };
}

export function makeDemoSites(): DemoSite[] {
  return [
    site('a', '周清和', '数学与统计学院', 'p2', {
      reason: 'unit_mismatch',
      research: '数值代数与科学计算',
    }),
    site('b', '陈砚秋', '', 'p4', { reason: 'site_unit_missing' }),
    site('c', '许文澜', '计算机学院', 'p3', {
      automaticTeacher: 'p3',
      research: '算法与分布式系统',
    }),
    {
      row: {
        site_id: `site-${'d'.repeat(64)}`,
        name: '陆怀远',
        unit: '人文社会科学学院',
        present: false,
        reason: 'site_unavailable',
        candidate_count: 0,
        candidates: [],
        decision_revision: 1,
        decision: { action: 'reject' },
      },
    },
    site('e', '沈若谷', '控制工程系', 'p5', {
      reason: 'unit_mismatch',
      research: '系统辨识与控制理论',
    }),
    site('f', '林知远', '数学科学学院', 'p1', {
      automaticTeacher: 'p1',
      research: '最优化与数值分析',
    }),
  ];
}

export function makeDemoControls() {
  return new Map<string, HomepageControls>([
    [
      'p1',
      {
        revision: 1,
        page_visibility: 'visible',
        independent: false,
        rules: [
          {
            field: { field: 'photo' },
            hidden: false,
            override: { photo: sourcePortrait },
          },
        ],
      },
    ],
    [
      'p9',
      {
        revision: 1,
        page_visibility: 'visible',
        independent: true,
        rules: [
          {
            field: { field: 'research' },
            hidden: false,
            override: { text: '模式识别与机器学习' },
          },
        ],
      },
    ],
  ]);
}

export function makeDemoRequests(): HomepageRequest[] {
  return [
    {
      id: 'th-demo-photo',
      teacher_id: 'p2',
      kind: 'correction',
      field: { field: 'photo' },
      value: { photo: requestPortrait },
      message: '请将教师主页头像替换为近期证件照。',
      status: 'pending',
      revision: 1,
      created_at: ago(0, 2),
    },
    {
      id: 'th-demo-research',
      teacher_id: 'p3',
      kind: 'supplement',
      field: { field: 'research' },
      value: { text: '算法与分布式系统、可信计算' },
      message: '请补充最近开始的可信计算研究方向。',
      status: 'pending',
      revision: 1,
      created_at: ago(1),
    },
    {
      id: 'th-demo-hide',
      teacher_id: 'p1',
      kind: 'hide',
      field: { field: 'phone' },
      message: '请从教师主页隐藏办公电话。',
      status: 'pending',
      revision: 1,
      created_at: ago(2),
    },
    {
      id: 'th-demo-rejected',
      teacher_id: 'p8',
      kind: 'correction',
      field: { field: 'position' },
      value: { text: '课程负责人' },
      message: '请更新教师主页中的职务。',
      status: 'rejected',
      revision: 2,
      created_at: ago(8),
      resolved_at: ago(7),
      resolution_note: '请补充院系出具的任职说明后重新提交。',
    },
  ];
}

export const defaultAllowlist = [
  { field: 'name' },
  { field: 'position' },
  { field: 'discipline' },
  { field: 'supervisors' },
  { field: 'biography' },
  { field: 'research' },
  { field: 'photo' },
  { field: 'fields', label: '学术活动' },
  { field: 'sections', label: '教学工作' },
  { field: 'sections', label: '科研项目' },
] satisfies HomepageField[];
