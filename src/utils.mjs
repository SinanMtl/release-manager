import chalk from 'chalk';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const ERROR_CODES = {
  COMMON: 0,
  CONFLICT: 1,
  NO_REF: 2
}

function getErrorCode(outputData) {
  if (outputData.match(new RegExp("fatal: couldn't find remote ref", 'gm'))) {
    return ERROR_CODES.NO_REF;
  }

  if (outputData.match(/CONFLICT/gm)) {
    return ERROR_CODES.CONFLICT;
  }

  return ERROR_CODES.COMMON
}

/**
 * @name runCommand
 * @param {string|string[]} commandStr Command string/list
 * @param {string} type Command type for error handling
 */
export async function runCommand(commandStr, type, debug) {
  return new Promise((resolve, reject) => {
    let outputData = '';
    let errData = '';

    /**
     * @type string[]
     */
    const commandList = Array.isArray(commandStr)
      ? commandStr
      : (commandStr || '').split(' ').map((item) => item.trim());

    if (!commandList.length) {
      reject({
        type,
        output: 'There is no command to execute!'
      })
      return;
    }

    const command = spawn(commandList[0], commandList.slice(1));

    command.stdout.on('data', (data) => {
      if (debug) console.log(`stdout: ${data}`);
      outputData += `${data}`;
    });
    
    command.stderr.on('data', (data) => {
      errData += `${data}`;
    });
    
    command.on('close', (code) => {
      if (code === 0) {
        resolve(outputData)
      } else {
        const errorCode = getErrorCode(outputData || errData);
        const hasConflict = errorCode === ERROR_CODES.CONFLICT;

        reject({
          type,
          output: hasConflict ? outputData : errData,
          code,
          errorCode: errorCode
        });
      }
      if (debug) console.log(`child process exited with code ${code}`);
    }); 
  })
}

/**
 * 
 * @param {{ type: string,  output: string }} err 
 */
export function errorHandling(err, debug) {
  const icon = '✖';
  switch(err.type) {
    case 'fetch_all_branch':
      console.log(chalk.red(`${icon} An error occurred while fetching remote branches`));
      break;
    case 'fetch_branch':
      console.log(chalk.red(`${icon} An error occurred while fetching remote branch`));
      break;
    case 'branch_list':
      console.log(chalk.red(`${icon} An error occurred while getting branch list`));
      break;
    case 'checkout_branch':
      console.log(chalk.red(`${icon} An error occurred while changing branch`));
      break;
    case 'create_branch':
      console.log(chalk.red(`${icon} An error occurred while creating branch`));
      break;
    case 'version':
      console.log(chalk.red(`${icon} Version is required`));
      break;
    case 'main_branch':
      console.log(chalk.red(`${icon} Main branch selection is required`));
      break;
    case 'current_branch':
      console.log(chalk.red(`${icon} An error occurred while getting current branch`));
      break;
    case 'pull_branch':
      console.log(chalk.red(`${icon} An error occurred while pulling branch`));
      break;
    case 'merge_branch':
      console.log(chalk.red(`${icon} An error occurred while merging branch`));
      break;
    case 'branches':
      console.log(chalk.red(`${icon} Merge branch selection is required`));
      break;
    case 'create_release_main_branch':
      console.log(chalk.red(`${icon} Main branch is required`));
      break;
    case 'create_branch_exists':
      console.log(chalk.red(`${icon} There is alredy a release branch for this version`));
      break;
  }

  if (debug && err.output) {
    console.log(chalk.green('≫'), 'OUTPUT:');
    console.log(err.output);
  }
}

export function saveFile(filename, dir, content) {
  const directory = dir;
  if (!fs.existsSync(directory)){
    fs.mkdirSync(directory);
  }
  const filePath = path.join(directory, filename);
  fs.writeFileSync(filePath, content);

  return filePath
}

export function readFile(filePath) {
  const directory = filePath;
  if (fs.existsSync(directory)) {
    const text = fs.readFileSync(directory, { encoding: 'utf8' })
    if (text) return JSON.parse(text);
  }

  return null;
}
