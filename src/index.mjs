#!/usr/bin/env node

import chalk from 'chalk';
import prompts from 'prompts';
import { ERROR_CODES, errorHandling, runCommand, saveFile, readFile } from './utils.mjs';

/*
You can simply run `node ./release/index.mjs`
This command aims to facilitate release management.

Steps:
1. Set release version
2. Select production branch
3. Select branches you want to include release

After that, the script prepares for you a release branch by version you enter (eg. release/v1.19.0).
*/

const debug = false;
const __dirname = process.cwd();
const fileDir = __dirname;
const fileName = 'release.json';
const filePath = `${fileDir}/${fileName}`;

async function fetchAllBranch() {
  return runCommand('git fetch --all', 'fetch_all_branch', debug);
}

async function fetchBranch(branchName) {
  return runCommand(`git fetch origin ${branchName}`, 'fetch_branch', debug);
}

async function checkoutBranch(branchName) {
  return runCommand(`git checkout ${branchName}`, 'checkout_branch', debug);
}

async function createBranch(branchName) {
  return runCommand(`git checkout -b ${branchName}`, 'create_branch_exists', debug);
}

async function getBranchList() {
  return runCommand(`git branch --all`, 'branch_list', debug)
    .then((output) => {
      return [...new Set(output.split('\n').map((item) => {
        const value = item.trim().replace(/^(remotes\/origin\/|\*)/, '').trim();
        if (/^HEAD/.test(value)) return null;
        return value;
      }).filter(Boolean))].sort();
    });
}

async function getCurrentBranch() {
  return runCommand(`git branch`, 'current_branch', debug)
    .then((stdout) => {
      const signOfCurrent = /\*/;
      let currentBranch = stdout.split('\n').map((item) => item.trim()).find((item) => signOfCurrent.test(item));
      if (currentBranch) currentBranch = currentBranch.replace(signOfCurrent, '').trim();
      return currentBranch;
    })
}

async function pullBranch(branchName) {
  return runCommand(`git pull origin ${branchName}`, 'pull_branch', debug)
}

async function mergeBranch(branchName) {
  return runCommand(`git merge ${branchName}`, 'merge_branch', debug)
}

export async function deleteUnrefBranchesOnLocal() {
  return runCommand(`git fetch -p && git branch -vv | awk '/: gone]/{print $1}' | xargs git branch -d`)
}

async function createReleaseBranch(mainBranch, releaseVersion) {
  try {
    if (!mainBranch) return { type: 'create_release_main_branch' };
    if (!releaseVersion) throw { type: 'version' }
    const releaseBranchName = `release/${releaseVersion}`;
    const currentBranch = await getCurrentBranch();
    if (currentBranch !== mainBranch) {
      await checkoutBranch(mainBranch);
    }
    
    await fetchBranch(mainBranch);
    await createBranch(releaseBranchName);
    return releaseBranchName
  } catch(err) {
    errorHandling(err, debug)
    console.log('createReleaseBranch ERR:', err?.message || err?.output);
    return false;
  }
}

/**
 * @param {string} branchName Branch name which will be merge
 * @param {string} targetBranch
 */
async function mergeFeatureBranch(branchName, targetBranch) {
  try {
    await fetchBranch(branchName);
    await checkoutBranch(branchName);
    await pullBranch(branchName);
    await checkoutBranch(targetBranch);
    await mergeBranch(branchName);

    return true;
  } catch(err) {
    errorHandling(err, debug)
    const message = err?.output || err?.message;
    console.log('mergeFeatureBranch ERR:', message);
    return err;
  }
}

/**
 * @param {string[]} branchList Branch list for merge
 * @param {string} targetBranch Target branch
 */
async function mergeFeatureBranches(branchList, targetBranch) {
  const merged = [];
  const conflicted = [];
  const unrefs = [];
  let hasConflict = false;
  let error = null;

  try {
    for await (const item of branchList) {
      const response = await mergeFeatureBranch(item, targetBranch);
      if (response?.output) {
        error = response;
        hasConflict = response?.errorCode === ERROR_CODES.CONFLICT;
        if (hasConflict) {
          conflicted.push(item);
          break;
        } else if (response?.errorCode === ERROR_CODES.NO_REF) {
          unrefs.push(item)
        }
      } else {
        merged.push(item);
      }
    }

    return {
      error,
      merged,
      unrefs,
      conflicted,
      hasConflict,
      unmerged: branchList.filter((item) => !merged.includes(item) && !conflicted.includes(item))
    };
  } catch(err) {
    errorHandling(err, debug)
    console.log('mergeFeatureBranches ERR', err?.output || err?.message);
    return {
      error,
      merged,
      unrefs,
      conflicted,
      hasConflict,
      unmerged: branchList.filter((item) => !merged.includes(item) && !conflicted.includes(item))
    };
  }
}

async function newReleasePrompt() {
  try {
    console.log(chalk.green('≫'), 'Fetching branches...');
    await fetchAllBranch();
    const branchList = await getBranchList();
    const developmentBranches = branchList.filter((branch) => !/^(release|hotfix)\//.test(branch));
    let defaultProdBranchIndex = developmentBranches.indexOf('master');
    if (defaultProdBranchIndex < 0) defaultProdBranchIndex = developmentBranches.indexOf('main');
    if (defaultProdBranchIndex < 0) defaultProdBranchIndex = undefined;
  
    const release = await prompts([
      {
        type: 'text',
        name: 'version',
        message: 'What is release version?',
        validate: (value) => {
          const pattern = /^(\d{1,})\.(\d{1,})\.(\d{1,})(-.*)?$/g;
          if (!value.match(pattern)) {
            return 'Please enter a valid semantic version (1.4.19, 2.23.4, 2.12.0-beta.1, etc).'
          }
  
          if (branchList.includes(`release/v${value}`)) {
            return 'There is alredy a release branch for this version'
          }
  
          return true
        },
        format: (value) => `v${value}`
      },
      {
        type: 'select',
        name: 'main_branch',
        message: 'Select your production branch',
        initial: defaultProdBranchIndex,
        clearFirst: true,
        choices: developmentBranches.map((item) => {
          return { title: item, value: item }
        })
      },
      {
        type: 'multiselect',
        name: 'all_branches',
        message: 'Select the branches you want to deploy',
        choices: (_, values) => {
          return developmentBranches.filter((item) => item !== values.main_branch).map((item) => {
            return { title: item, value: item }
          })
        }
      }
    ]);

    release.branches = release.all_branches;
    release.conflicted = [];
    release.merged = [];
    release.unmerged = [];
    release.unrefs = [];

    return release;
  } catch(err) {
    errorHandling(err, debug);
    return null
  }
}

async function continueWithOldRelease(release) {
  try {
    console.log(chalk.green('≫'), 'Fetching branches...');
    await fetchAllBranch();
    const currentBranch = await getCurrentBranch();
    const releaseBranchName = `release/${release.version}`;

    if (currentBranch !== releaseBranchName) {
      const branchList = await getBranchList();

      if (branchList.includes(releaseBranchName)) {
        await checkoutBranch(releaseBranchName);
      } else {
        if (currentBranch !== release.main_branch) {
          await checkoutBranch(release.main_branch);
        }
        await createBranch(releaseBranchName);
      }
    }

    return release;
  } catch(err) {
    errorHandling(err, debug);
    return null
  }
}

(async () => {
  try {
    const lastRelease = readFile(filePath);
    let confirmPrompt = {};
    let release = {};

    if (lastRelease) {
      confirmPrompt = await prompts({
        type: 'confirm',
        name: 'continue',
        message: `There is an incomplete release (${lastRelease.version}). Do you want to continue?`,
        initial: true
      });

      if (confirmPrompt.continue) {
        release = await continueWithOldRelease(lastRelease);
        if (release?.unmerged?.length) {
          release.branches = release.unmerged;
        }
      } else {
        release = await newReleasePrompt();
      }
    } else {
      release = await newReleasePrompt();
    }
  
    if (!release.version) {
      throw { type: 'version' }
    }

    if (!release.main_branch) {
      throw { type: 'main_branch' }
    }

    if (!release.branches) {
      throw { type: 'branches' }
    }

    const releaseBranchName = confirmPrompt.continue
      ? release.releaseBranchName
      : await createReleaseBranch(release.main_branch, release.version);

    const result = await mergeFeatureBranches(release.branches, releaseBranchName);
    const fileObj = {
      ...release,
      releaseBranchName,
      unrefs: result?.unrefs || [],
      conflicted: [...new Set([...(result?.conflicted || []), ...(release?.conflicted || [])])],
      merged: [...new Set([...(result?.merged || []), ...(release?.merged || [])])],
      unmerged: result?.unmerged || []
    }

    if (result.hasConflict) {
      console.log(chalk.bold(chalk.red(`⚠ (CONFLICT) Please resolve conflict for ${releaseBranchName} then apply merge commit and re-run command again. The command will continue where it stop.`)))
    } else if (!result.unmerged.length) {
      console.log(`${releaseBranchName} is ready to deploy! See result below`)
      console.log(fileObj);
      console.log(chalk.bold('\nJust in case, be sure everything is ok.\n'))
    } else {
      console.log(chalk.bold(chalk.yellow(`Here is some warnings that you should aware. Please read:`)))

      if (result?.error?.errorCode === ERROR_CODES.NO_REF) {  
        console.log(chalk.bold(`\n≫ Some branches has not to reference on remote. See list below`))
        console.log('\t', result.unrefs);
      }

      if (result?.unmerged?.length) {
        console.log(chalk.bold(`\n≫ Some branches has not to merge to ${releaseBranchName}. See list below`))
        console.log('\t', result.unmerged);
        console.log(chalk.bold('\nYou can still deploy your release but just in case, be sure everything is ok.\n'))
      }
    }

    // Save state
    saveFile(fileName, fileDir, JSON.stringify(fileObj, null, 2));

    if (result?.error?.errorCode) throw result;

  } catch(err) {
    errorHandling(err, debug);
    console.log(err?.message || '');
  }
})();
