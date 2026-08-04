import assert from "node:assert/strict";
import test from "node:test";
import { getPremiumEntitlements } from "./premium-entitlements";

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);

test("Stripe active, Play inactive grants Premium", () => {
  assert.equal(getPremiumEntitlements({ premiumStatus: "active" }).isPremium, true);
});

test("Stripe inactive, Play active grants Premium", () => {
  assert.equal(getPremiumEntitlements({ googlePlaySubscriptionStatus: "ACTIVE", googlePlaySubscriptionEnd: future }).isPremium, true);
});

test("both active grants Premium", () => {
  assert.equal(getPremiumEntitlements({ premiumStatus: "active", googlePlaySubscriptionStatus: "ACTIVE", googlePlaySubscriptionEnd: future }).source, "both");
});

test("neither active is Free", () => {
  assert.equal(getPremiumEntitlements({}).isPremium, false);
});

test("Stripe trialing grants Premium", () => {
  assert.equal(getPremiumEntitlements({ premiumStatus: "trialing" }).isPremium, true);
});

test("canceled Stripe retains paid-through access", () => {
  assert.equal(getPremiumEntitlements({ premiumStatus: "canceled", premiumAccessUntil: future }).isPremium, true);
});

test("expired Play subscription is Free", () => {
  assert.equal(getPremiumEntitlements({ googlePlaySubscriptionStatus: "ACTIVE", googlePlaySubscriptionEnd: past }).isPremium, false);
});

test("Play active with future expiration grants Premium", () => {
  assert.equal(getPremiumEntitlements({ googlePlaySubscriptionStatus: "ACTIVE", googlePlaySubscriptionEnd: future }).googlePlayActive, true);
});