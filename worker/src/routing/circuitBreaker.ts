/**
 * Circuit Breaker and Proactive Rate Limiting Service
 *
 * Implements Layer 1 (sliding window RPS/RPM/RPD) and Layer 2 (CLOSED / OPEN / HALF-OPEN state machine).
 * Enforces single HALF-OPEN probe guard, in-flight acquisition/release, maxInflight bounds,
 * generation counters against stale outcomes, and separate explicit account-level cooldown tracking.
 */

import { ProviderRouteConfig } from '../config/providers';
import { Env, ProviderCircuitState } from '../types';
import { calculateRouteCooldown, isExplicitAccountScopeError } from './errorTaxonomy';

/** Default duration for explicit account-scope suspension cooldown (1 hour) */
const EXPLICIT_ACCOUNT_COOLDOWN_MS = 60 * 60 * 1000;

export class CircuitBreakerService {
  private circuits = new Map<string, ProviderCircuitState>();
  /** Shared cooldowns across routes sharing the same account API key */
  private accountCooldowns = new Map<string, number>();

  /**
   * Retrieves or initializes the circuit state for a provider route.
   *
   * @param routeId - Route unique identifier.
   * @param now - Current epoch timestamp.
   * @returns Mutable ProviderCircuitState.
   */
  getCircuit(routeId: string, now = Date.now()): ProviderCircuitState {
    let circuit = this.circuits.get(routeId);
    if (!circuit) {
      circuit = {
        state: 'CLOSED',
        cooldownUntil: 0,
        consecutiveFailures: 0,
        generation: 0,
        halfOpenInFlight: false,
        inFlightCount: 0,
        currentSecondWindow: Math.floor(now / 1000),
        secondCount: 0,
        currentMinuteWindow: Math.floor(now / 60000),
        minuteCount: 0,
        currentDayWindow: new Date(now).toISOString().slice(0, 10),
        dayCount: 0,
      };
      this.circuits.set(routeId, circuit);
    }
    return circuit;
  }

  /**
   * Rotates sliding time windows for a circuit based on the current timestamp.
   *
   * @param circuit - Circuit state to rotate.
   * @param now - Current epoch timestamp.
   */
  private rotateWindows(circuit: ProviderCircuitState, now: number): void {
    const sec = Math.floor(now / 1000);
    if (circuit.currentSecondWindow !== sec) {
      circuit.currentSecondWindow = sec;
      circuit.secondCount = 0;
    }

    const min = Math.floor(now / 60000);
    if (circuit.currentMinuteWindow !== min) {
      circuit.currentMinuteWindow = min;
      circuit.minuteCount = 0;
    }

    const day = new Date(now).toISOString().slice(0, 10);
    if (circuit.currentDayWindow !== day) {
      circuit.currentDayWindow = day;
      circuit.dayCount = 0;
    }
  }

  /**
   * Pre-dispatch eligibility and lease acquisition.
   * Checks route enablement, credentials, AI bindings, maxInflight limits,
   * account-level cooldowns, circuit state machine, and sliding rate limits.
   *
   * @param route - Target provider route.
   * @param env - Worker environment bindings.
   * @param now - Current epoch timestamp.
   * @returns Object with acquisition status, circuit generation, and rejection reason if any.
   */
  acquireRoute(
    route: ProviderRouteConfig,
    env: Env,
    now = Date.now()
  ): { acquired: boolean; generation: number; reason?: string } {
    if (!route.enabled) {
      return { acquired: false, generation: 0, reason: 'Route disabled' };
    }

    if (route.apiKeyEnvVar && !env[route.apiKeyEnvVar]) {
      return { acquired: false, generation: 0, reason: 'Missing API key' };
    }

    if (route.type === 'workers-ai' && !env.AI) {
      return { acquired: false, generation: 0, reason: 'Missing env.AI binding' };
    }

    // Check shared explicit account-level cooldown
    if (route.apiKeyEnvVar) {
      const accountCooldownUntil = this.accountCooldowns.get(route.apiKeyEnvVar) || 0;
      if (now < accountCooldownUntil) {
        return { acquired: false, generation: 0, reason: 'Account-level suspension cooldown active' };
      }
    }

    const circuit = this.getCircuit(route.id, now);

    // Concurrency limit check
    if (route.maxInflight && circuit.inFlightCount >= route.maxInflight) {
      return { acquired: false, generation: circuit.generation, reason: 'Max in-flight concurrency reached' };
    }

    // Layer 2: Circuit Breaker State Transition Check
    if (circuit.state === 'OPEN') {
      if (now >= circuit.cooldownUntil) {
        circuit.state = 'HALF-OPEN';
        circuit.generation += 1;
        circuit.halfOpenInFlight = false;
      } else {
        return { acquired: false, generation: circuit.generation, reason: 'Circuit OPEN in cooldown' };
      }
    }

    // Critical constraint: Single HALF-OPEN probe guard
    if (circuit.state === 'HALF-OPEN') {
      if (circuit.halfOpenInFlight) {
        return { acquired: false, generation: circuit.generation, reason: 'HALF-OPEN probe already in flight' };
      }
      circuit.halfOpenInFlight = true;
    }

    // Layer 1: Sliding Window Rate Limits Check
    this.rotateWindows(circuit, now);

    if (route.rpsLimit && circuit.secondCount >= route.rpsLimit) {
      if (circuit.state === 'HALF-OPEN') circuit.halfOpenInFlight = false;
      return { acquired: false, generation: circuit.generation, reason: 'RPS limit reached' };
    }

    if (route.rpmLimit && circuit.minuteCount >= route.rpmLimit) {
      if (circuit.state === 'HALF-OPEN') circuit.halfOpenInFlight = false;
      return { acquired: false, generation: circuit.generation, reason: 'RPM limit reached' };
    }

    if (route.rpdLimit && circuit.dayCount >= route.rpdLimit) {
      if (circuit.state === 'HALF-OPEN') circuit.halfOpenInFlight = false;
      return { acquired: false, generation: circuit.generation, reason: 'RPD limit reached' };
    }

    // Acquire in-flight reservation
    circuit.secondCount += 1;
    circuit.minuteCount += 1;
    circuit.dayCount += 1;
    circuit.inFlightCount += 1;

    return { acquired: true, generation: circuit.generation };
  }

  /**
   * Releases an in-flight execution lease exactly once.
   *
   * @param routeId - Route unique identifier.
   */
  releaseRoute(routeId: string): void {
    const circuit = this.circuits.get(routeId);
    if (circuit && circuit.inFlightCount > 0) {
      circuit.inFlightCount -= 1;
    }
  }

  /**
   * Records outcome of a dispatch attempt and updates circuit breaker state.
   * Rejects stale outcomes whose generation no longer matches the live circuit.
   * Does NOT release the route lease; caller must invoke releaseRoute in a finally block.
   *
   * @param route - Target provider route.
   * @param success - Whether execution succeeded and passed validation.
   * @param statusCode - HTTP status code.
   * @param generation - Generation id captured at pre-dispatch acquisition.
   * @param errorText - Error details.
   * @param retryAfterSeconds - Upstream Retry-After value.
   * @param now - Current timestamp.
   */
  recordOutcome(
    route: ProviderRouteConfig,
    success: boolean,
    statusCode: number,
    generation: number,
    errorText?: string,
    retryAfterSeconds?: number,
    now = Date.now()
  ): void {
    const circuit = this.getCircuit(route.id, now);

    // Reject stale outcomes from a previous generation
    if (generation !== circuit.generation) {
      return;
    }

    if (success) {
      circuit.state = 'CLOSED';
      circuit.consecutiveFailures = 0;
      circuit.halfOpenInFlight = false;
      return;
    }

    circuit.consecutiveFailures += 1;
    circuit.halfOpenInFlight = false;

    // Check if error is an explicit account-scope failure
    if (route.apiKeyEnvVar && isExplicitAccountScopeError(statusCode, errorText)) {
      this.accountCooldowns.set(route.apiKeyEnvVar, now + EXPLICIT_ACCOUNT_COOLDOWN_MS);
    }

    const cooldownMs = calculateRouteCooldown(
      statusCode,
      errorText,
      retryAfterSeconds,
      circuit.consecutiveFailures
    );

    circuit.state = 'OPEN';
    circuit.cooldownUntil = now + cooldownMs;
    circuit.generation += 1;
  }

  /**
   * Resets half-open probe lock on request-specific safety refusals without penalizing provider health.
   *
   * @param route - Target provider route.
   * @param generation - Acquisition generation id.
   */
  recordSafetyRefusal(route: ProviderRouteConfig, generation: number): void {
    const circuit = this.getCircuit(route.id);
    if (generation === circuit.generation) {
      circuit.halfOpenInFlight = false;
    }
  }
}
