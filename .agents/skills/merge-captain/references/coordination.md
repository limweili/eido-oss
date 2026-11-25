# Coordination with ongoing implementation

The goal is a closed information loop without making the owner relay technical
state.

## What implementation hands over

- intended outcome and dependency rationale;
- live change pointers and exact reviewed identity;
- Standards and Spec verdicts with their boundaries;
- existing evidence and what invalidates it;
- owned resources and protected dependents;
- known risks and expected tracker effects.

## What landing returns

- landed identity and shared-target proof;
- tracker and dependency changes;
- repairs or conflict resolutions applied and their revalidation;
- preserved or cleaned resources;
- blockers, residual risk, and what is newly unblocked.

The transport can be any reliable channel appropriate to the environment. It
must preserve provenance and must not impersonate owner authority. Completion
notifications are hints until live state confirms their claims.

The implementation coordinator may continue independent work while landing is
in progress, but shared surfaces with an unintegrated change remain owned and
are not safe foundations for competing work.
