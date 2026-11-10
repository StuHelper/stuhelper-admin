// A server-selected community school for school-scoped administration fixtures.
export async function schoolSession(page, school = 'school') {
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: {
    authenticated: true, content_school_id: school,
    profile: { id: '00000000-0000-4000-8000-000000000001', nickname: 'Fixture admin', nickname_required: false, bio: '', visibility: { school: true, badge: true, department: true, grade: false, reviews: true, resources: true }, group_card_consent: { school: false, grade: false, department: false, name: false, student_id: false, gender: false, nickname: false }, revision: 1 },
    csrf_token: 'a'.repeat(43), phone_bound: true, administrator: true, expires_at: '2030-01-01T00:00:00Z',
  } }));
}
