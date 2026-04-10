// js/models/modelQueue.js
//
// Central inference scheduler.
// Prevents multiple simultaneous model calls from
// overwhelming Ollama or remote APIs.

const queue = [];

let active = 0;

let MAX_CONCURRENT = 1; // safest for Ollama

export function setModelConcurrency(n) {
  MAX_CONCURRENT = Math.max(1, Number(n) || 1);
}

export function enqueueModelCall(fn, label = "model-call") {

  return new Promise((resolve, reject) => {

    queue.push({
      fn,
      resolve,
      reject,
      label
    });

    processQueue();

  });

}

async function processQueue() {

  if (active >= MAX_CONCURRENT) return;

  const job = queue.shift();

  if (!job) return;

  active++;

  try {

    const result = await job.fn();

    job.resolve(result);

  }
  catch (err) {

    job.reject(err);

  }
  finally {

    active--;

    processQueue();

  }

}