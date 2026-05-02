import axios from 'axios';

function unwrap(response) {
  const body = response.data;
  if (body && body.success === false) {
    throw new Error(body.error || 'NAS request failed');
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'data')) return body.data;
  return body;
}

export const nasApi = {
  get: (url, config) => axios.get(url, config).then(unwrap),
  post: (url, data, config) => axios.post(url, data, config).then(unwrap),
  put: (url, data, config) => axios.put(url, data, config).then(unwrap),
  delete: (url, config) => axios.delete(url, config).then(unwrap),
};
