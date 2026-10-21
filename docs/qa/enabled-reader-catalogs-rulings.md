# Enabled reader catalogs: controller rulings

These 23 rulings preserve the chronological decisions from the plan execution ledger. Code and release evidence are recorded separately in [the acceptance report](enabled-reader-catalogs-acceptance.md). Costs below state the consequence of an incorrect decision, not an observed failure.

1. Ruling: Reuse the existing isolated linked worktree on codex/suwayomi-connection; no new checkout or reset is needed. Cost if wrong: Integration rework if the reused checkout is unsuitable; no reset was performed.

2. Ruling: The approved plan permits independent tracks in parallel with disjoint ownership; shared route files, migrations and dist-changing checks remain serialized. Cost if wrong: integration/review rework; no publication before final review.

3. Ruling: Push/publication/bridge recreation are explicitly authorized already; do not request conversational approval again. Cost if wrong: An unintended release would require the retained-image and compatible-baseline recovery; the user explicitly authorized these actions.

4. Ruling: concurrent task reviews preserve dispatch BASE..task HEAD and scope diff to that task's explicitly owned paths if unrelated disjoint commits intervene; final whole-branch review covers all paths from 06cdd0a. Cost if wrong: A cross-task interaction could escape a scoped review; the final whole-branch review covers the combined change.

5. Ruling: all Git index/stage/commit mutations serialized by root commit-slot grant. Explicit paths alone do not avoid a shared-index race. Current slot Task2, Task4 waits READY. Future parallel implementers must request slot before staging. Cost if wrong: Commit throughput is slower, while index races are prevented.

6. Ruling: allowindependentTask9unitworkbefore8review usingstablematerialization seam; no sharededits or finalacceptanceuntil8complete — removesidle time withoutwaivingpolicy/review. Cost if wrong: Localized integration rework if the prerequisite materialization contract changes.

7. Ruling: start11independentUIworkagainststablecontextcontract—finalruntimeacceptance remainsafter10complete; ifcontractchangescostislocalizedUIrework.

8. Ruling: exclusive dist slot ALSO freezes existing bundled/runtime source inputs ofotheragents duringbuild/testartifact sequence; unimportednewmodules/puretests/scratchmayproceed — preventsincompletecross-taskcodepollutingvalidation, costdelayssharedUIwrites.8priorityfreshbuild/retest, resumebugmustfixedoridentified, nocommitwithknownfailures.

9. Ruling: commit8exactownedGREENpatchwithoutwaitingunrelatedfuturefeatureRED; finalTask14fullzero-failuregate unchanged, reportredrunexplicitly, noskippingtests.8reviewwilluseactualcommitparent84442c2 ratherthandispatch125fsoapproved7sharedschema/APIchangesnotre-reviewed. Cost if wrong: An unrelated integration failure can remain until final acceptance; historical red results stay explicit.

10. Ruling:8fixmayvalidateisolatedgitarchive7e85+ONLYownfixpaths+sharedimmutabledependencyjunction, nofutureUI/schemaWIP; recordsownartifactevidence vsfinalintegrated14gates. Thisavoidsanother10unmountedgatefalsefailure.12RUNTIMEeditsholdreleasedownedfilesnow, Prefetch11/sharedroom9/state10stillheld;13freshstandardhighBASE7e85 docs/WebMCPprepstartedthenownedWebMCPeditsreleasedbecause8isolated. Allcommits/buildsrootslots;10dependenciesmustcommitbefore11/12/13. Currentsharedartifactstillprior8Sites. Cost if wrong: Isolated checks do not certify the final combined tree, which retains its own acceptance evidence.

11. Ruling: accept substantive chapter-activity wrong-title/zero-write coverage in native-social-policy.test.mjs and actual native-social-contract.mjs instead of moving it to chapter-activity.test.mjs — equivalent behavior is covered through both runtimes; cost if wrong is test discoverability, not missing contract coverage. M2 expected SQLite/intentional XML rollback diagnostics remain explicitly recorded, no global suppression.

12. Ruling: permit exactly Task10-authored readinessKey:viewKey caller hunk in Task8R3 staged patch alongside resume.js and owned resume.spec (including preserved Task12 query compatibility) — makes central fix review self-contained without staging unrelated state WIP; cost if wrong is localized hunk integration rework. Actual current history authorization retains full inventory generation.

13. Ruling: after409/uncertain dispatched guest synchronization timeout, passive timer/focus refresh may GET/reconcile/report but must not POST unchanged stale projection with a new revision; add per-destination active-session resync barrier cleared by explicit membership/mode/reset action — closes a delayed automatic replay path; cost if wrong is requiring a fresh explicit user selection after rare conflicts. Routine successful lease renewal remains automatic, no server API/durable sync system added. Task10 focused regression required before next compile.

14. Ruling: fix actual Ara copied-room-invite path inside Room.jsx using destination-aware collectionPath, with positive copied pathname assertion in existing Ara room case — copied URLs bypassed Link normalization and opened Yoru404; cost if wrong is localized invite navigation rework. Preserve active132batch, append assertion after it; RED existingartifact, then freshSites affectedcase only bothviewports, finalNode check under14. No API/sharedroom identity change and no repeated132suite for local link fix.

15. Ruling: Treat the original a20 full browser run as 323 passed / 29 failed / 4 intentional viewport skips, then resolve the 29 with affected reruns instead of repeating 356 after each scoped fix; keep every failed run and artifact boundary explicit. Cost if wrong: an unaffected journey could regress without a fresh full final-SHA run.

16. Ruling: Record original format:check failure from ignored SDD scratch separately from the passing scoped command that preserves existing ignores and excludes only that scratch. Cost if wrong: discarded scratch formatting remains unchecked; tracked source checks remain required.

17. Ruling: Keep a compatible v107 generic-disabled baseline and retained bridge images as recovery targets; do not use v106 after native Ara records exist. Cost if wrong: recovery may hide generic content until reenabling, but keeps additive records and exact progress.

18. Ruling: Diagnose actual live integration failures after code review without reopening broad scans: the initial provider capability promotion, package/default mismatch and unknown page sentinel each require producer-shaped regressions and scoped review. Cost if wrong: extra release time; no unrelated implementation scope.

19. Ruling: Preserve existing package/source/binding identities and map exactly 21 inventory-backed package IDs to existing preference-family names in the consumer; explicit family or package false wins, then true, then the family default, with unknown packages default-disabled. Cost if wrong: a new package requires a curated alias, and conflicting explicit disables require reset or an explicit correction.

20. Ruling: Normalize only the empirically confirmed Suwayomi page-count sentinel -1 to DTO unknown count 0; fetch the real count lazily without changing exact edition identity, preserving all other invalid-count rejection and ownership checks. Cost if wrong: page totals remain unknown until first fetch; malformed other counts still fail closed.

21. Ruling: Authorize one additional bounded production Webtoons feed beyond the two isolated feed calls solely to index and verify the deployed database path, then exact chapter/manifest/page-zero and cached repeat; no provider hunting or additional page acquisition. Cost if wrong: one extra provider feed request within the existing deadline/concurrency limits.

22. Ruling: Publish the working integration with an explicit per-operation matrix rather than claim universal installed-provider availability; one generic safe read and dedicated Weeb Central are proved, while additional empty/unavailable providers and real adult-page coverage remain disclosed limitations. Cost if wrong: some enabled catalogs may still be unavailable; their exact core alternatives remain selectable and no provider is silently substituted.

23. Ruling: Permit a 30-second outer HTTP allowance only for the production probe's existing exact-title chapter/manifest/page continuation, while every bridge/provider deadline remains 12 seconds and no additional feed is requested. Earlier 12-second whole-app probe timeouts remain failures in the record. Cost if wrong: the operator waits longer for network/D1 materialization; this does not certify a 12-second end-to-end application latency.
