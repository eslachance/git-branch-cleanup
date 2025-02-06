#!/usr/bin/env node
/**
 * git-cleanup.js
 *
 * A Node.js CLI tool to help clean up local Git branches that have no active upstream branch.
 *
 * This script assumes you are running it within a Git repository and already authenticated.
 *
 * It lists local branches that either:
 *  - have no upstream branch, or
 *  - have an upstream branch that is marked as "gone"
 *
 * Then it offers these options:
 *   1. Delete all such local branches (safe delete)
 *   2. Delete all such local branches (forced delete)
 *   3. Delete all such local branches except "main"/"master"
 *   4. Cancel
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
 * In the above, "bugfix" has no tracking info and "oldfeat" has an upstream
 * that is no longer present (indicated by ": gone"). Both will be flagged.
 */
function getDetachedBranches(callback) {
  exec('git branch -vv', (error, stdout, stderr) => {
    if (error) {
      return callback(new Error("Error running 'git branch -vv'."));
    }
    const lines = stdout.split('\n');
    const detachedBranches = [];
    // Regex explanation:
    //   ^\*?\s*         -> optional '*' for the current branch plus any whitespace
    //   (\S+)           -> branch name (non-space characters)
    //   \s+[a-f0-9]+    -> commit hash
    //   \s+(\[([^\]]+)\])? -> optional tracking info in brackets.
    const branchLineRegex = /^\*?\s*(\S+)\s+[a-f0-9]+\s+(\[([^\]]+)\])?/;
    lines.forEach(line => {
      const match = line.match(branchLineRegex);
      if (match) {
        const branchName = match[1];
        const trackingInfo = match[3]; // may be undefined if no tracking info exists
        // If there is no tracking info, or if it includes "gone", then consider the branch stale.
        if (!trackingInfo || trackingInfo.includes('gone')) {
          detachedBranches.push(branchName);
        }
      }
    });
    callback(null, detachedBranches);
  });
}

// --- Branch Deletion Functions ---

/**
 * Delete the given branches.
 *
 * @param {string[]} branches - List of branch names to delete.
 * @param {boolean} forced - If true, use forced deletion (-D); otherwise use safe deletion (-d).
 * @param {function} callback - Called when deletion is complete.
 */
function deleteBranches(branches, forced, callback) {
  let index = 0;

  function deleteNext() {
    if (index >= branches.length) {
      return callback(null);
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
          console.error(`Error deleting branch ${branch}: ${stderr.trim()}`);
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
    console.log("  3. Delete all such local branches except 'main'/'master'");
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
      if (option === 1 || option === 2) {
        const forced = (option === 2);
        deleteBranches(branches, forced, (err) => {
          if (err) console.error("Error during branch deletion:", err);
          else console.log("Cleanup operation completed.");
          process.exit(0);
        });
      }
      if (option === 3) {
        // Filter out the "main" and "master" branches.
        const filtered = branches.filter(b =>
          (b.toLowerCase() !== 'main') && (b.toLowerCase() !== 'master')
        );
        if (filtered.length === 0) {
          console.log("No branches available to delete after filtering out main/master.");
          process.exit(0);
        }
        deleteBranches(filtered, false, (err) => {
          if (err) console.error("Error during branch deletion:", err);
          else console.log("Cleanup operation completed.");
          process.exit(0);
        });
      }
    });
  });
}

main();
