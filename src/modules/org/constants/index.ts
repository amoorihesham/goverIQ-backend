export const CONFIGURATIONS = {
  DEFAULT_QUORUM_THRESHOLD: 0.5,
  SLUG_MAX_SUFFIX_ATTEMPTS: 9,
  SLUG_FALLBACK_RANDOM_BYTES: 2,
  // Partitions the pg_advisory_xact_lock keyspace so slug locks can't collide
  // with advisory locks taken elsewhere in the app. Any stable int4 works;
  // change it only by coordinating with every other module that uses advisory locks.
  SLUG_LOCK_NAMESPACE: 0x534c5547,
};
