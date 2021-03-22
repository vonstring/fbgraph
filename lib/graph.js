/**
 * Module Dependencies
 */

var request      = require('request')
  , qs           = require('qs')
  , url          = require('url')
  , crypto       = require('crypto')
  , noop         = function(){}
  , util         = require('util');

/**
 * Library version
 */

exports.version = '1.3.0';

/**
 * Graph Stream
 *
 * @param {String} method
 * @param {String} url
 * @param {object/function} - postData
 * - object to be used for post
 * - assumed to be a callback function if callback is undefined
 * @param {function/undefined} - callback function
 */

class GraphStream {
  constructor (graph, method, url, postData, callback) {
    this.graph = graph;
    if (typeof callback === 'undefined') {
      callback  = postData;
      postData  = {};
    }

    url           = this.prepareUrl(url);
    this.callback = callback || noop;
    this.postData = postData;

    this.options          = Object.assign({}, this.graph.getOptions());
    this.options.encoding = this.options.encoding || 'utf-8';

    // these particular set of options should be immutable
    this.options.method         = method;
    this.options.uri            = url;
    this.options.followRedirect = false;

    this.request = this[method.toLowerCase()]();
  }
  
  /**
   * "Prepares" given url string
   * - adds protocol and host prefix if none is given
   * @param {string} url string
   */
  prepareUrl(url) {
    url = this.cleanUrl(url);

    if (url.substr(0,4) !== 'http') {
      url = this.graph.getGraphUrl() + '/v' + this.graph.getVersion() + url;
    }

    return url;
  };

  /**
   * "Cleans" given url string
   * - adds lading slash
   * - adds access token if we have one
   * - adds appsecret_proof if we have an accessToken and appSecret
   * @param {string} url string
   */

  cleanUrl(url) {
    url = url.trim();

    // prep access token in url for appsecret proofing
    var regex = /access_token=([^&]*)/;
    var results = regex.exec(url);
    var sessionAccessToken = results ? results[1] : this.graph.getAccessToken();

    // add leading slash
    if (url.charAt(0) !== '/' && url.substr(0,4) !== 'http') url = '/' + url;

    // add access token to url
    if (this.graph.getAccessToken() && url.indexOf('access_token=') === -1) {
      url += ~url.indexOf('?') ? '&' : '?';
      url += "access_token=" + this.graph.getAccessToken();
    }

    // add appsecret_proof to the url
    if (sessionAccessToken && this.graph.getAppSecret() && url.indexOf('appsecret_proof') === -1) {
      var hmac = crypto.createHmac('sha256', this.graph.getAppSecret());
      hmac.update(sessionAccessToken);

      url += ~url.indexOf('?') ? '&' : '?';
      url += "appsecret_proof=" + hmac.digest('hex');
    }

    return url;
  };

  /**
   * Gets called on response.end
   * @param {String|Object} body
   */

  end(body) {
    var json = typeof body === 'string' ? null : body
      , err  = null;

    if (!json) {
      try {

        // this accounts for `real` json strings
        if (~body.indexOf('{') && ~body.indexOf('}')) {
          json = JSON.parse(body);

        } else {
          // this accounts for responses that are plain strings
          // access token responses have format of "accessToken=....&..."
          // but facebook has random responses that just return "true"
          // so we'll convert those to { data: true }
          if (!~body.indexOf('='))    body = 'data=' + body;
          if (body.charAt(0) !== '?') body = '?' + body;

          json = url.parse(body, true).query;
        }

      } catch (e) {
        err = {
            message: 'Error parsing json'
          , exception: e
        };
      }
    }

    if (!err && (json && json.error)) err = json.error;

    this.callback(err, json);
  };


  /**
   * https.get request wrapper
   */

  get() {
    var self = this;

    return request.get(this.options, function(err, res, body) {
      if (err) {
        self.callback({
            message: 'Error processing https request'
          , exception: err
        }, null);

        return;
      }

      if (~res.headers['content-type'].indexOf('image')) {
        body = {
            image: true
          , location: res.headers.location
        };
      }

      self.end(body);
    }).on('error', function(err) {
      self.callback({
            message: 'Error processing https request'
          , exception: err
        }, null);
    });
  };


  /**
   * https.post request wrapper
   */

  post() {

    var self     = this
      , postData = qs.stringify(this.postData);

    this.options.body  = postData;

    return request(this.options, function (err, res, body) {
      if (err) {
        self.callback({
            message: 'Error processing https request'
          , exception: err
        }, null);

        return;
      }

      self.end(body);
    })
    .on('error', function(err) {
      self.callback({
            message: 'Error processing https request'
          , exception: err
        }, null);
    });

  };

}

class Graph {
  #accessToken;
  #appSecret;
  #graphUrl = 'https://graph.facebook.com';
  #graphVersion = '2.9';
  #oauthDialogUrl = "https://www.facebook.com/v2.0/dialog/oauth?";
  #oauthDialogUrlMobile = "https://m.facebook.com/v2.0/dialog/oauth?";
  #requestOptions = {};

  constructor() {
  }

  /**
   * Accepts an url an returns facebook
   * json data to the callback provided
   *
   * if the response is an image
   * ( FB redirects profile image requests directly to the image )
   * We'll send back json containing  {image: true, location: imageLocation }
   *
   * Ex:
   *
   *    Passing params directly in the url
   *
   *      graph.get("zuck?fields=picture", callback)
   *
   *    OR
   *
   *      var params = { fields: picture };
   *      graph.get("zuck", params, callback);
   *
   *    GraphApi calls that redirect directly to an image
   *    will return a json response with relavant fields
   *
   *      graph.get("/zuck/picture", callback);
   *
   *      {
   *        image: true,
   *        location: "http://profile.ak.fbcdn.net/hprofile-ak-snc4/157340_4_3955636_q.jpg"
   *      }
   *
   *
   * @param {object} params
   * @param {string} url
   * @param {function} callback
   */

  get(url, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params   = null;
    }

    if (typeof url !== 'string') {
      return callback({ message: 'Graph api url must be a string' }, null);
    }

    if (params)  {
      url += ~url.indexOf('?') ? '&' : '?';
      url += qs.stringify(params);
    }

    return new GraphStream(this, 'GET', url, callback);
  };

  /**
   * Publish to the facebook graph
   * access token will be needed for posts
   * Ex:
   *
   *    var wallPost = { message: "heyooo budday" };
   *    graph.post(friendID + "/feed", wallPost, callback);
   *
   * @param {string} url
   * @param {object} postData
   * @param {function} callback
   */

  post(url, postData, callback) {
    if (typeof url !== 'string') {
      return callback({ message: 'Graph api url must be a string' }, null);
    }

    if (typeof postData === 'function') {
      callback = postData;
      postData = url.indexOf('access_token') !== -1 ? {} : {access_token: this.#accessToken};
    }

    return new GraphStream(this, 'POST', url, postData, callback);
  };

  /**
   * Deletes an object from the graph api
   * by sending a "DELETE", which is really
   * a post call, along with a method=delete param
   *
   * @param {string} url
   * @param {object} postData (optional)
   * @param {function} callback
   */

  del(url, postData, callback) {
    if (!url.match(/[?|&]method=delete/i)) {
      url += ~url.indexOf('?') ? '&' : '?';
      url += 'method=delete';
    }

    if (typeof postData === 'function') {
      callback = postData;
      postData = url.indexOf('access_token') !== -1 ? {} : {access_token: this.#accessToken};
    }

    return this.post(url, postData, callback);
  };

  /**
   * Perform a batch query on the graph api
   *
   * @param  {Array}    reqs     An array containing queries
   * @param  {[Object]} additionalData Additional data to send, e.g. attachments or the `include_headers` parameter.
   * @param  {Function} callback
   *
   * @see https://developers.facebook.com/docs/graph-api/making-multiple-requests
   */

  batch(reqs, additionalData, callback) {
    if (!(reqs instanceof Array)) {
      return callback({ message: 'Graph api batch requests must be an array' }, null);
    }

    if (typeof additionalData === 'function') {
      callback = additionalData;
      additionalData = {};
    }

    return new GraphStream(this, 'POST', '', Object.assign({}, {
      access_token: this.#accessToken,
      batch: JSON.stringify(reqs)
    }, additionalData), callback);
  };

  /**
   * @param {object} params containing:
   *   - client_id
   *   - redirect_uri
   * @param {object} opts  Options hash. { mobile: true } will return mobile oAuth URL
   * @returns the oAuthDialogUrl based on params
   */
  getOauthUrl(params, opts) {
    var url = (opts && opts.mobile) ? this.#oauthDialogUrlMobile : this.#oauthDialogUrl;
    return url + qs.stringify(params);
  };

  /**
   * Authorizes user and sets the
   * accessToken if everything worked out
   *
   * @param {object} params containing:
   *   - client_id
   *   - redirect_uri
   *   - client_secret
   *   - code
   * @param {function} callback
   */

  authorize(params, callback) {
    var self = this;

    return this.get("/oauth/access_token", params, function(err, res) {
      if (!err) self.setAccessToken(res.access_token);

      callback(err, res);
    });
  };

  /**
   * Extends the expiration time of accessToken
   *
   * @param {object} params containing:
   *   - client_id
   *   - client_secret
   *   - access_token (optional)
   * @param {function} callback
   */

  extendAccessToken(params, callback) {
      var self = this;

      params.grant_type        = 'fb_exchange_token';
      params.fb_exchange_token = params.access_token ? params.access_token : this.getAccessToken();

      return this.get("/oauth/access_token", params, function(err, res) {
        if (!err && !params.access_token) {
          self.setAccessToken(res.access_token);
        }

        callback(err, res);
      });
  };

  /**
   * Set request options.
   * These are mapped directly to the
   * `request` module options object
   * @param {Object} options
   */

  setOptions(options) {
    if (typeof options === 'object')  this.#requestOptions = options;

    return this;
  };

  /**
   * @returns the request options object
   */

  getOptions = function() {
    return this.#requestOptions;
  };

  /**
   * Sets the access token
   * @param {string} token
   */

  setAccessToken = function(token) {
    this.#accessToken = token;
    return this;
  };

  /**
   * @returns the access token
   */

  getAccessToken() {
    return this.#accessToken;
  };

  /**
   * Set's the Graph API version.
   * Note that you don't need to specify the 'v', just
   * add '2.1', '1.1' etc
   * @param {string} version
   */
  setVersion(version) {
    // set version
    this.#graphVersion = version;

    // update auth urls
    this.#oauthDialogUrl       = "https://www.facebook.com/v"+version+"/dialog/oauth?"; // oldest version for auth
    this.#oauthDialogUrlMobile = "https://m.facebook.com/v"+version+"/dialog/oauth?";   // oldest version for auth

    return this;
  };

  
  /**
   * @returns the Graph API version
   */

   getVersion() {
    return this.#graphVersion;
  };


  /**
   * Sets the app secret, used to verify all API calls if provided
   * @param {string} token
   */

  setAppSecret = function(token) {
    this.#appSecret = token;
    return this;
  };

  /**
   * @returns the app secret
   */

  getAppSecret() {
    return this.#appSecret;
  };

  /**
   * sets graph url
   */

  setGraphUrl(url) {
    this.#graphUrl = url;
    return this;
  };

  /**
   * @returns the graphUrl
   */

  getGraphUrl = function() {
    return this.#graphUrl;
  }
}

class PromiseGraph extends Graph {
  async get(url, params) {
    return util.promisify(super.get.bind(this))(url, params);
  }

  async authorize(params) {
    let res = await this.get("/oauth/access_token", params);
    this.setAccessToken(res.access_token);
    return res;
  };

  async post(url, postData) {
    return util.promisify(super.post.bind(this))(url, postData);
  }

  async del(url, postData) {
    return util.promisify(super.del.bind(this))(url, postData);
  }

  async batch(reqs, additionalData) {
    return util.promisify(super.batch.bind(this))(reqs, additionalData);
  }

  async extendAccessToken(params) {
    params.grant_type        = 'fb_exchange_token';
    params.fb_exchange_token = params.access_token ? params.access_token : this.getAccessToken();

    let res = await this.get("/oauth/access_token", params);
    if (params.access_token) {
      this.setAccessToken(res.access_token);
    }
    return res;
  }
}

const defaultGraph = new Graph();
module.exports = defaultGraph;
module.exports.Graph = Graph;
module.exports.PromiseGraph = PromiseGraph;