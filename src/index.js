#!/usr/bin/env node
/**
 * git-branch-cleanup
 *
 * A Node.js CLI tool to help clean up local Git branches whose upstream is missing
 * or has been deleted.
 *
 */

const prompt = require('prompt');
const { exec } = require('child_process');
const fs = require('fs');

// Global variable to ensure the disclaimer is only shown once.
let disclaimerConfirmed = false;

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
 * Check if a branch exists by listing it.
 */
function branchExists(branchName, callback) {
  exec(`git branch --list ${branchName}`, (err, stdout, stderr) => {
    if (err) return callback(false);
    callback(stdout.trim() !== "");
  });
}

/**
 * Determine the default main branch.
 * If both "main" and "master" exist, prompt the user which one is their default.
 */
function getDefaultMainBranch(callback) {
  branchExists("main", (mainExists) => {
    branchExists("master", (masterExists) => {
      if (mainExists && masterExists) {
        prompt.start();
        prompt.get({
          name: 'default',
          description: "Both 'main' and 'master' branches exist. Which branch do you use as your default? (enter 'main' or 'master')",
          required: true,
          pattern: /^(main|master)$/i,
          message: "Please enter 'main' or 'master'"
        }, (err, result) => {
          if (err) return callback(err);
          callback(null, result.default.toLowerCase());
        });
      } else if (mainExists) {
        callback(null, "main");
      } else if (masterExists) {
        callback(null, "master");
      } else {
        // Neither exists; no default main branch found.
        callback(null, null);
      }
    });
  });
}

/**
 * Get all local branches that either:
 *   - have no upstream branch, or
 *   - have an upstream branch that is marked as "gone"
 *
 * Uses "git branch -vv" and inspects the tracking info.
 */
function getDetachedBranches(callback) {
  exec('git branch -vv', (error, stdout, stderr) => {
    if (error) {
      return callback(new Error("Error running 'git branch -vv'."));
    }
    const lines = stdout.split('\n');
    const detachedBranches = [];
    // Regex explanation:
    //   ^\*?\s*           -> optional '*' (for the current branch) and any whitespace
    //   (\S+)             -> branch name (non-space characters)
    //   \s+[a-f0-9]+      -> commit hash
    //   \s+(\[([^\]]+)\])? -> optional tracking info in brackets
    const branchLineRegex = /^\*?\s*(\S+)\s+[a-f0-9]+\s+(\[([^\]]+)\])?/;
    lines.forEach(line => {
      const match = line.match(branchLineRegex);
      if (match) {
        const branchName = match[1];
        const trackingInfo = match[3]; // may be undefined if no tracking info exists
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
 *                              where failedBranches is an array of branches that could not be deleted
 *                              (only applicable in safe deletion mode).
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

/**
 * Before performing deletion, check if the current branch matches the default main branch.
 * If not, prompt the user:
 *
 *   "You are not currently on the '<defaultMain>' branch.
 *    Would you like to switch to '<defaultMain>' before cleanup?
 *      1. Yes, switch to '<defaultMain>' branch to clean up this one.
 *      2. No, stay on this branch and ignore it in the cleanup."
 *
 * Depending on the choice:
 *   - Option 1: switch to the default main branch.
 *   - Option 2: remove the current branch from the cleanup list.
 */
function preCleanupCheck(branchesToDelete, defaultMain, callback) {
  // If no default main branch is defined, or if the cleanup options already exclude it, continue.
  if (!defaultMain) return callback(null, branchesToDelete);
  
  getCurrentBranch((err, currentBranch) => {
    if (err) return callback(err);
    if (currentBranch.toLowerCase() === defaultMain.toLowerCase()) {
      // Already on the default main branch.
      return callback(null, branchesToDelete);
    }
    console.log(`You are not currently on the '${defaultMain}' branch. (Current branch: '${currentBranch}')`);
    prompt.get({
      name: 'switch',
      description: `Would you like to switch to '${defaultMain}' branch before cleanup? (Yes/No)`,
      required: true,
      pattern: /^(yes|no|y|n)$/i,
      message: "Please enter yes or no"
    }, (err, result) => {
      if (err) return callback(err);
      if (result.switch.toLowerCase() === 'yes' || result.switch.toLowerCase() === 'y') {
        // Switch to defaultMain branch.
        exec(`git checkout ${defaultMain}`, (err, stdout, stderr) => {
          if (err) {
            return callback(new Error(`Failed to switch to ${defaultMain}: ${stderr.trim()}`));
          }
          console.log(`Switched to ${defaultMain}.`);
          callback(null, branchesToDelete);
        });
      } else {
        // Option 2: Remain on the current branch, so remove it from the deletion list.
        const filtered = branchesToDelete.filter(b => b.toLowerCase() !== currentBranch.toLowerCase());
        callback(null, filtered);
      }
    });
  });
}

/**
 * Show the disclaimer message (in bold red) and ask for confirmation.
 * The disclaimer is shown only once per execution.
 */
function confirmDisclaimer(callback) {
  if (disclaimerConfirmed) {
    callback();
    return;
  }
  // ANSI escape codes for red (31) and bold (1)
  const warningMessage = "\x1b[31m\x1b[1mWARNING: Branches deleted locally cannot be recovered. If you have any local unsaved work that has not been pushed to a remote repository, IT WILL BE LOST. Use this tool at your own risk. The maintainers assume no responsibility for any data loss. Always review the branches marked for deletion before confirming the cleanup process.\x1b[0m";
  console.log(warningMessage);
  prompt.get({
    name: 'confirm',
    description: 'Do you wish to proceed? (Yes/No)',
    required: true,
    pattern: /^(yes|no|y|n)$/i,
    message: "Please enter yes or no"
  }, (err, result) => {
    if (err) {
      console.error("Prompt error:", err);
      process.exit(1);
    }
    if (result.confirm.toLowerCase() === 'yes' || result.confirm.toLowerCase() === 'y') {
      disclaimerConfirmed = true;
      callback();
    } else {
      console.log("Cleanup operation cancelled by user.");
      process.exit(0);
    }
  });
}

// --- Main Script Logic ---

function main() {
  if (!isGitRepo()) {
    console.error("Error: This script must be run inside a Git repository (no .git folder found).");
    process.exit(1);
  }

  // First, determine the default main branch.
  getDefaultMainBranch((err, defaultMain) => {
    if (err) {
      console.error("Error determining default branch:", err);
      process.exit(1);
    }
    
    // Next, get the list of branches that need cleanup.
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
      console.log("  1. Delete all detached local branches (safe delete)");
      console.log("  2. Delete all detached local branches (forced delete)");
      if (defaultMain) {
        console.log(`  3. Delete all such local branches except '${defaultMain}' (safe delete)`);
      } else {
        console.log("  3. Delete all such local branches except 'main/master' (safe delete)");
      }
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
        
        let branchesToDelete = branches;
        if (option === 3 && defaultMain) {
          // Exclude the default main branch from deletion.
          branchesToDelete = branches.filter(b => b.toLowerCase() !== defaultMain.toLowerCase());
          if (branchesToDelete.length === 0) {
            console.log(`No branches available to delete after filtering out '${defaultMain}'.`);
            process.exit(0);
          }
        }
        
        // Before deletion, check if the current branch is the default branch.
        preCleanupCheck(branchesToDelete, defaultMain, (err, finalBranchesToDelete) => {
          if (err) {
            console.error("Error during pre-cleanup check:", err);
            process.exit(1);
          }
          if (finalBranchesToDelete.length === 0) {
            console.log("No branches available to delete after pre-cleanup adjustments.");
            process.exit(0);
          }
          
          // Show the disclaimer once before starting deletion.
          confirmDisclaimer(() => {
            // Proceed with deletion based on the chosen cleanup option.
            if (option === 1 || option === 3) {
              // Safe deletion with potential forced deletion prompt.
              deleteBranches(finalBranchesToDelete, false, (err, failedBranches) => {
                if (err) {
                  console.error("Error during branch deletion:", err);
                  process.exit(1);
                }
                if (failedBranches.length > 0) {
                  prompt.get({
                    name: 'force',
                    description: `The above branches were not fully merged and could not be deleted. Do you want to force delete them? (Yes/No)`,
                    required: true,
                    pattern: /^(yes|no|y|n)$/i,
                    message: "Please enter yes or no"
                  }, (err, result) => {
                    if (err) {
                      console.error("Prompt error:", err);
                      process.exit(1);
                    }
                    if (result.force.toLowerCase() === 'yes' || result.force.toLowerCase() === 'y') {
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
            } else if (option === 2) {
              // Forced deletion immediately.
              deleteBranches(finalBranchesToDelete, true, (err, _) => {
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
      });
    });
  });
}

main();
