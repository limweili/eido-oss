## PLAN 

Investigate and review the open PRs for this project right now.

I want a list that indicates the following:
- Which are ready to merge
- Which are mostly good but need a rebase or other small touch ups
- Which have been trumped (either with better PRs or things merged already)
- Which have good ideas but are better off scrapped and rewritten

Use a workflow to break up the work, and multiple reviewers to help solidify your decisions.

1. Close all PRs that have been trumped or are otherwise not worth keeping around
2. Help me spec and prioritize the work for the other PRs you think you should close. Write up new html plans for a "best path forward" implementation for those features and fixes, honoring the goal of simplicity that we strive for in this project

Break up the planning work into subagents. Review the plans with subagents as well. A workflow may be helpful.

Once you have plans you are happy with for each of those pieces of work, share the links with me so I can review them.

Make sure the plans you write have links to the PRs they are inspired by. If multiple PRs implement same feature, link to all of them. Make sure to describe where the existing implementation is and how you feel we should handle the next one.


## GOAL

/goal Complete all the work we have discussed here. You have permission to create worktrees, rebase, branch, merge PRs, close PRs, etc.

Go through all of the work step by step, and mark each todo in TODO.md done when completed. The TODO.md changes should be committed and merged as you go.

Use the tools available to you to break this work up logically, review it thoroughly, and merge with confidence. Do not merge code until my automated code reviewers have approved it (Bugbot, macroscope and coderabbit).