import type { components } from '#/api/billing.gen';

import { type Http, segment } from '#/shared/api/http';
import { schemaOf } from '#/shared/api/schema';
import { useHttp } from '#/shared/session';

import contract from '../../../../../contracts/billing.openapi.json';

type Schemas = components['schemas'];
export type AdminOrder = Schemas['AdminOrder'];
export type Order = Schemas['Order'];
export type Channel = Schemas['Channel'];
export type Offer = Schemas['Offer'];
export type Rule = Schemas['Rule'];
export type Reward = Schemas['Reward'];
export type Target = Schemas['Target'];
export type Account = Schemas['AdminAccount'];
export type ReviewInput = Schemas['ReviewInput'];
export type ManualInput = Schemas['ManualInput'];
export type GrantInput = Schemas['GrantInput'];
export type RevokeInput = Schemas['RevokeInput'];
export type PurchaseRefundInput = Schemas['PurchaseRefundInput'];
export type PaymentReviewInput = Schemas['PaymentReviewInput'];
export type MembershipPlan = Schemas['MembershipPlan'];
export type ResourcePrice = Schemas['ResourcePrice'];
export type Payee = Schemas['Payee'];
export type Principal = Schemas['Principal'];

const schemas = contract.components.schemas;
const parse = {
  account: schemaOf<Account>(schemas, 'AdminAccount'),
  channel: schemaOf<Channel>(schemas, 'Channel'),
  channels: schemaOf<Schemas['AdminChannelPage']>(schemas, 'AdminChannelPage'),
  offer: schemaOf<Offer>(schemas, 'Offer'),
  offers: schemaOf<Schemas['AdminOfferPage']>(schemas, 'AdminOfferPage'),
  order: schemaOf<Order>(schemas, 'Order'),
  refunds: schemaOf<Schemas['AdminRefundPage']>(schemas, 'AdminRefundPage'),
  reward: schemaOf<Reward>(schemas, 'Reward'),
  rule: schemaOf<Rule>(schemas, 'Rule'),
  rules: schemaOf<Schemas['AdminRulePage']>(schemas, 'AdminRulePage'),
  plan: schemaOf<MembershipPlan>(schemas, 'MembershipPlan'),
  plans: schemaOf<MembershipPlan[]>(schemas, 'MembershipPlan', true),
  price: schemaOf<ResourcePrice>(schemas, 'ResourcePrice'),
  payee: schemaOf<Payee>(schemas, 'Payee'),
};

/** Refund states an administrator filters by; the server lists submitted refunds by default. */
export const refundStates = ['submitted', 'awaiting_manual', 'needs_review', 'review_query_pending', 'awaiting_details', 'processing', 'succeeded', 'failed', 'rejected'] as const;
export const purchaseRefundReasons: PurchaseRefundInput['reason'][] = ['duplicate_charge', 'under_delivery'];
export const pageSize = 50;

/**
 * Exact decimal text of a minor-unit amount, so large amounts keep every digit
 * when passed to Intl.NumberFormat.
 */
export function minorText(minor: number) {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Parse a yuan amount typed by an administrator into minor units; undefined when invalid. */
export function parseMinor(text: string): number | undefined {
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Billing administration: refund review, configuration, rewards and account reads. Every read of an account is audited. */
export class BillingAdmin {
  constructor(private readonly http: Http) {}

  account(target: Target, pages: { ledger?: string; orders?: string; } = {}, signal?: AbortSignal) {
    return this.http.json('/api/v1/billing/admin/accounts', parse.account, {
      query: { issuer: target.issuer, subject: target.subject, orders_after: pages.orders || undefined, orders_limit: pageSize, ledger_after: pages.ledger || undefined, ledger_limit: pageSize },
      signal,
    });
  }

  channels(signal?: AbortSignal) {
    return this.all('/api/v1/billing/admin/channels', parse.channels, signal);
  }

  /** Refund a resource unlock or membership order to the account it was paid from. */
  commerceRefund(body: { amount: number; order_id: string; reason: string; target: Principal }, key: string) {
    return this.http.json('/api/v1/billing/admin/commerce-refunds', parse.order, { method: 'POST', body, key });
  }

  /** Stop selling a plan; memberships already granted keep their period. */
  deletePlan(id: string, key: string) {
    return this.http.json(`/api/v1/billing/admin/membership-plans/${segment(id)}`, parse.plan, { method: 'DELETE', key });
  }

  grant(body: GrantInput, key: string) {
    return this.http.json('/api/v1/billing/admin/rewards', parse.reward, { method: 'POST', body, key });
  }

  /** Give a membership without payment; the reason is recorded with the order. */
  grantMembership(body: { plan_id: string; reason: string; target: Principal }, key: string) {
    return this.http.json('/api/v1/billing/admin/memberships/grants', parse.order, { method: 'POST', body, key });
  }

  manualResult(id: string, body: ManualInput, key: string) {
    return this.http.json(`/api/v1/billing/admin/refunds/${segment(id)}/manual-result`, parse.order, { method: 'POST', body, key });
  }

  offers(signal?: AbortSignal) {
    return this.all('/api/v1/billing/admin/offers', parse.offers, signal);
  }

  /** Refund payee details. Reading them needs a separate permission and is audited before they are returned. */
  payee(refundID: string, target: Principal, signal?: AbortSignal) {
    return this.http.json(`/api/v1/billing/admin/refunds/${segment(refundID)}/payee`, parse.payee, { query: { issuer: target.issuer, subject: target.subject }, signal });
  }

  /**
   * Resolve an order whose automatic payment queries ran out: schedule one more query, or
   * record the result an administrator verified with the channel, citing the evidence.
   */
  paymentReview(id: string, body: PaymentReviewInput, key: string) {
    return this.http.json(`/api/v1/billing/admin/orders/${segment(id)}/payment-review`, parse.order, { method: 'POST', body, key });
  }

  /** Membership plans, including disabled ones; at most 100 are configured. */
  plans(signal?: AbortSignal) {
    return this.http.json('/api/v1/billing/admin/membership-plans', parse.plans, { query: { limit: 100 }, signal });
  }

  purchaseRefund(body: PurchaseRefundInput, key: string) {
    return this.http.json('/api/v1/billing/admin/purchase-refunds', parse.order, { method: 'POST', body, key });
  }

  async refunds(state: string, after: string, signal?: AbortSignal) {
    return this.http.json('/api/v1/billing/admin/refunds', parse.refunds, { query: { state, after, limit: pageSize }, signal });
  }

  resourcePrice(id: string, signal?: AbortSignal) {
    return this.http.json(`/api/v1/billing/resource-prices/${segment(id)}`, parse.price, { signal });
  }

  review(id: string, body: ReviewInput, key: string) {
    return this.http.json(`/api/v1/billing/admin/refunds/${segment(id)}/review`, parse.order, { method: 'POST', body, key });
  }

  revoke(body: RevokeInput, key: string) {
    return this.http.json('/api/v1/billing/admin/revocations', parse.reward, { method: 'POST', body, key });
  }

  rules(signal?: AbortSignal) {
    return this.all('/api/v1/billing/admin/rules', parse.rules, signal);
  }

  saveChannel(body: Channel, key: string) {
    return this.http.json(`/api/v1/billing/admin/channels/${segment(body.id)}`, parse.channel, { method: 'POST', body, key });
  }

  saveOffer(body: Offer, key: string) {
    return this.http.json(`/api/v1/billing/admin/offers/${segment(body.id)}`, parse.offer, { method: 'POST', body, key });
  }

  /** Create or change a plan; the version read is sent back and a concurrent change is rejected. */
  savePlan(body: MembershipPlan, key: string) {
    return this.http.json(`/api/v1/billing/admin/membership-plans/${segment(body.id)}`, parse.plan, { method: 'PUT', body, key });
  }

  saveResourcePrice(body: ResourcePrice, key: string) {
    return this.http.json(`/api/v1/billing/admin/resource-prices/${segment(body.resource_id)}`, parse.price, { method: 'PUT', body, key });
  }

  saveRule(body: Rule, key: string) {
    return this.http.json(`/api/v1/billing/admin/rules/${segment(body.id)}`, parse.rule, { method: 'POST', body, key });
  }

  /** Every page of a configuration list, including disabled items; at most ten pages. */
  private async all<T>(path: string, parser: (value: unknown) => { items: T[]; next: string }, signal?: AbortSignal) {
    const items: T[] = [];
    let after = '';
    for (let page = 0; page < 10; page++) {
      const result = await this.http.json(path, parser, { query: { after: after || undefined, limit: 100 }, signal });
      items.push(...result.items);
      if (!result.next || result.next === after) return items;
      after = result.next;
    }
    return items;
  }
}

export function useBillingAdmin() {
  return new BillingAdmin(useHttp());
}
