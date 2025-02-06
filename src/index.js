#!/usr/bin/env node
/**
 * git-cleanup.js
 *
 * A Node.js CLI tool to help clean up local Git branches whose upstream is missing
 * or has been deleted.
 *
 * This script lists local branches that either:
 *   - have no upstream branch, or
 *   - have an upstream branch that is marked as "gone"
 *
 * It then offers these options:
 *   1. Delete all such local branches (safe delete)
 *   2. Delete all such local branches (forced delete)
 *   3. Delete all such local branches except "main"/"master" (safe delete)
 *   4. Cancel
 *
 * In the safe deletion process, if any branch cannot be deleted because it is not
 * fully merged, a friendly message is printed. Once the safe deletion process is
 * finished, the user is asked if they want to force delete the branches that failed.
 *
 * To install the "prompt" module, run:
 *    npm install prompt
 */

const prompt = require('prompt');
const { exec } = require('child_process');
const fs = require('fs');

// --- Git Repository Checks ---

function isGitRepo() {
  return fs.existsSync('.git');
}

function getCurrentBranch(callback) {
  exec('git rev-parse --abbrev-ref HEAD', (error, stdout, stderr) => {
    if (error) {
      return callback(new Error("Failed to get current branch. Are you sure this is a Git repository?"));
    }
    callback(null, stdout.trim());
  });
}

/**
 * Get all local branches that either:
 *  - have no upstream branch, or
 *  - have an upstream branch that is marked as "gone"
 *
 * The output of "git branch -vv" typically shows lines like:
 *
 *    * feature   1a2b3c4 [origin/feature] Commit message...
 *      bugfix    5d6e7f8 Commit message...
 *      oldfeat   9a8b7c6 [origin/oldfeat: gone] Some commit message...
 *
 * In the above, "bugfix" has no tracking info and "oldfeat" has an upstream that is gone.
 */
function getDetachedBranches(callback) {
  exec('git branch -vv', (error, stdout, stderr) => {
    if (error) {
      return callback(new Error("Error running 'git branch -vv'."));
    }
    const lines = stdout.split('\n');
    const detachedBranches = [];
    // Regex explanation:
    //   ^\*?\s*           -> optional '*' for the current branch plus any whitespace
    //   (\S+)             -> branch name (non-space characters)
    //   \s+[a-f0-9]+      -> commit hash
    //   \s+(\[([^\]]+)\])? -> optional tracking info in brackets.
    const branchLineRegex = /^\*?\s*(\S+)\s+[a-f0-9]+\s+(\[([^\]]+)\])?/;
    lines.forEach(line => {
      const match = line.match(branchLineRegex);
      if (match) {
        const branchName = match[1];
        const trackingInfo = match[3]; // may be undefined if no tracking info exists
        // If there is no tracking info, or if it includes "gone", then mark it.
        if (!trackingInfo || trackingInfo.includes('gone')) {
          detachedBranches.push(branchName);
        }
      }
    });
    callback(null, detachedBranches);
  });
}

/**
 * Delete the given branches.
 *
 * @param {string[]} branches - List of branch names to delete.
 * @param {boolean} forced - If true, use forced deletion (-D); otherwise, use safe deletion (-d).
 * @param {function} callback - Called when deletion is complete.
 *                              The callback is passed (error, failedBranches)
 *                              where failedBranches is an array of branch names that
 *                              could not be deleted (in safe deletion mode).
 */
function deleteBranches(branches, forced, callback) {
  let index = 0;
  const failedBranches = [];
  
  function deleteNext() {
    if (index >= branches.length) {
      return callback(null, failedBranches);
    }
    const branch = branches[index++];
    getCurrentBranch((err, currentBranch) => {
      if (err) return callback(err);
      if (branch === currentBranch) {
        console.log(`Skipping current branch: ${branch}`);
        return deleteNext();
      }
      const delCmd = forced ? `git branch -D ${branch}` : `git branch -d ${branch}`;
      exec(delCmd, (err, stdout, stderr) => {
        if (err) {
          // For safe deletion, if the branch is not fully merged, show a friendly message.
          if (!forced && stderr.includes("not fully merged")) {
            console.error(`Unable to delete ${branch} as it is not fully merged.`);
            failedBranches.push(branch);
          } else {
            console.error(`Error deleting branch ${branch}: ${stderr.trim()}`);
          }
        } else {
          console.log(`Deleted branch ${branch}`);
        }
        deleteNext();
      });
    });
  }
  deleteNext();
}

// --- Main Script Logic ---

function main() {
  if (!isGitRepo()) {
    console.error("Error: This script must be run inside a Git repository (no .git folder found).");
    process.exit(1);
  }

  getDetachedBranches((err, branches) => {
    if (err) {
      console.error(err.message);
      process.exit(1);
    }
    if (branches.length === 0) {
      console.log("No local branches with missing or gone upstreams were found.");
      process.exit(0);
    }
    console.log("The following local branches have no active upstream branch (or their upstream is gone):\n");
    branches.forEach(b => console.log(`  • ${b}`));
    console.log(""); // extra newline

    // Present the cleanup options to the user.
    console.log("Choose one of the following options:");
    console.log("  1. Delete all such local branches (safe delete)");
    console.log("  2. Delete all such local branches (forced delete)");
    console.log("  3. Delete all such local branches except 'main'/'master' (safe delete)");
    console.log("  4. Cancel");

    prompt.start();
    prompt.get({
      name: 'option',
      description: 'Enter the number for your option',
      type: 'number',
      required: true,
      conform: function(value) {
        return [1, 2, 3, 4].includes(Number(value));
      }
    }, (err, result) => {
      if (err) {
        console.error("Prompt error:", err);
        process.exit(1);
      }
      const option = Number(result.option);
      if (option === 4) {
        console.log("Operation cancelled.");
        process.exit(0);
      }

      // For option 3, filter out main/master from the branches list.
      let branchesToDelete = branches;
      if (option === 3) {
        branchesToDelete = branches.filter(b =>
          (b.toLowerCase() !== 'main') && (b.toLowerCase() !== 'master')
        );
        if (branchesToDelete.length === 0) {
          console.log("No branches available to delete after filtering out main/master.");
          process.exit(0);
        }
      }

      // For options 1 and 3, we start with safe deletion.
      if (option === 1 || option === 3) {
        deleteBranches(branchesToDelete, false, (err, failedBranches) => {
          if (err) {
            console.error("Error during branch deletion:", err);
            process.exit(1);
          }
          // If some branches could not be deleted safely, prompt to force delete them.
          if (failedBranches.length > 0) {
            prompt.get({
              name: 'force',
              description: `The following branches were not fully merged and could not be deleted: ${failedBranches.join(", ")}. Do you want to force delete them? (yes/no)`,
              required: true,
              pattern: /^(yes|no)$/i,
              message: "Please enter yes or no"
            }, (err, result) => {
              if (err) {
                console.error("Prompt error:", err);
                process.exit(1);
              }
              if (result.force.toLowerCase() === 'yes') {
                // Force delete the branches that failed safe deletion.
                deleteBranches(failedBranches, true, (err, _) => {
                  if (err) {
                    console.error("Error during forced branch deletion:", err);
                    process.exit(1);
                  }
                  console.log("Forced deletion completed.");
                  process.exit(0);
                });
              } else {
                console.log("Cleanup operation completed with safe deletion.");
                process.exit(0);
              }
            });
          } else {
            console.log("Cleanup operation completed.");
            process.exit(0);
          }
        });
      }

      // For option 2, forced deletion is used immediately.
      if (option === 2) {
        deleteBranches(branchesToDelete, true, (err, _) => {
          if (err) {
            console.error("Error during forced branch deletion:", err);
            process.exit(1);
          }
          console.log("Forced deletion completed.");
          process.exit(0);
        });
      }
    });
  });
}

main();
