;(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};/**
 * Module dependencies.
 */

var Base64Url         = require('./lib/base64_url');
var assert_required   = require('./lib/assert_required');
var is_array          = require('./lib/is-array');
var index_of          = require('./lib/index-of');

var qs                = require('qs');
var xtend             = require('xtend');
var trim              = require('trim');
var reqwest           = require('reqwest');
var WinChan           = require('winchan');

var jsonp             = require('jsonp');
var jsonpOpts         = { param: 'cbx', timeout: 8000, prefix: '__auth0jp' };

var same_origin       = require('./lib/same-origin');
var json_parse        = require('./lib/json-parse');
var LoginError        = require('./lib/LoginError');
var use_jsonp         = require('./lib/use_jsonp');

/**
 * Check if running in IE.
 *
 * @returns {Number} -1 if not IE, IE version otherwise.
 */
function isInternetExplorer() {
  var rv = -1; // Return value assumes failure.
  var ua = navigator.userAgent;
  var re;
  if (navigator.appName === 'Microsoft Internet Explorer') {
    re = new RegExp('MSIE ([0-9]{1,}[\.0-9]{0,})');
    if (re.exec(ua) != null) {
      rv = parseFloat(RegExp.$1);
    }
  }
  // IE > 11
  else if (ua.indexOf('Trident') > -1) {
    re = new RegExp('rv:([0-9]{2,2}[\.0-9]{0,})');
    if (re.exec(ua) !== null) {
      rv = parseFloat(RegExp.$1);
    }
  }

  return rv;
}

/**
 * Stringify popup options object into
 * `window.open` string options format
 *
 * @param {Object} popupOptions
 * @private
 */

function stringifyPopupSettings(popupOptions) {
  var settings = '';

  for (var key in popupOptions) {
    settings += key + '=' + popupOptions[key] + ',';
  }

  return settings.slice(0, -1);
}


/**
 * Check that a key has been set to something different than null
 * or undefined.
 *
 * @param {Object} obj
 * @param {String} key
 */
function checkIfSet(obj, key) {
  /*
   * false      != null -> true
   * true       != null -> true
   * undefined  != null -> false
   * null       != null -> false
   */
  return !!(obj && obj[key] != null);
}

function handleRequestError(err, callback) {
  var er = err;
  var isAffectedIEVersion = isInternetExplorer() === 10 || isInternetExplorer() === 11;
  var zeroStatus = (!er.status || er.status === 0);

  var onLine = !!window.navigator.onLine;

  // Request failed because we are offline.
  if (zeroStatus && !onLine ) {
    er = {};
    er.status = 0;
    er.responseText = {
      code: 'offline'
    };
  // http://stackoverflow.com/questions/23229723/ie-10-11-cors-status-0
  // XXX IE10 when a request fails in CORS returns status code 0
  // See: http://caniuse.com/#search=navigator.onLine
  } else if (zeroStatus && isAffectedIEVersion) {
    er = {};
    er.status = 401;
    er.responseText = {
      code: 'invalid_user_password'
    };
  // If not IE10/11 and not offline it means that Auth0 host is unreachable:
  // Connection Timeout or Connection Refused.
  } else if (zeroStatus) {
    er = {};
    er.status = 0;
    er.responseText = {
      code: 'connection_refused_timeout'
    };
  } else {
    er.responseText = err;
  }
  var error = new LoginError(er.status, er.responseText);
  callback(error);
}

/**
 * join url from protocol
 */

function joinUrl(protocol, domain, endpoint) {
  return protocol + '//' + domain + endpoint;
}

/**
 * Create an `Auth0` instance with `options`
 *
 * @class Auth0
 * @constructor
 */
function Auth0 (options) {
  // XXX Deprecated: We prefer new Auth0(...)
  if (!(this instanceof Auth0)) {
    return new Auth0(options);
  }

  assert_required(options, 'clientID');
  assert_required(options, 'domain');

  this._useJSONP = null != options.forceJSONP ?
                    !!options.forceJSONP :
                    use_jsonp() && !same_origin('https:', options.domain);

  this._clientID = options.clientID;
  this._callbackURL = options.callbackURL || document.location.href;
  this._shouldRedirect = !!options.callbackURL;
  this._domain = options.domain;
  this._callbackOnLocationHash = false || options.callbackOnLocationHash;
  this._cordovaSocialPlugins = {
    facebook: this._phonegapFacebookLogin
  };
  this._useCordovaSocialPlugins = false || options.useCordovaSocialPlugins;
  this._sendClientInfo = null != options.sendSDKClientInfo ? options.sendSDKClientInfo : true;
}

/**
 * Export version with `Auth0` constructor
 *
 * @property {String} version
 */

Auth0.version = require('./version.json').version;

/**
 * Export client info object
 *
 *
 * @property {Hash}
 */

Auth0.clientInfo = { name: 'auth0.js', version: Auth0.version };


/**
 * Redirect current location to `url`
 *
 * @param {String} url
 * @private
 */

Auth0.prototype._redirect = function (url) {
  global.window.location = url;
};

Auth0.prototype._getCallbackOnLocationHash = function(options) {
  return (options && typeof options.callbackOnLocationHash !== 'undefined') ?
    options.callbackOnLocationHash : this._callbackOnLocationHash;
};

Auth0.prototype._getCallbackURL = function(options) {
  return (options && typeof options.callbackURL !== 'undefined') ?
    options.callbackURL : this._callbackURL;
};

Auth0.prototype._getClientInfoString = function () {
  var clientInfo = JSON.stringify(Auth0.clientInfo);
  return Base64Url.encode(clientInfo);
};

Auth0.prototype._getClientInfoHeader = function () {
  return {
    'Auth0-Client': this._getClientInfoString()
  };
};

/**
 * Renders and submits a WSFed form
 *
 * @param {Object} options
 * @param {Function} formHtml
 * @private
 */

Auth0.prototype._renderAndSubmitWSFedForm = function (options, formHtml) {
  var div = document.createElement('div');
  div.innerHTML = formHtml;
  var form = document.body.appendChild(div).children[0];

  if (options.popup && !this._getCallbackOnLocationHash(options)) {
    form.target = 'auth0_signup_popup';
  }

  form.submit();
};

/**
 * Resolve response type as `token` or `code`
 *
 * @return {Object} `scope` and `response_type` properties
 * @private
 */

Auth0.prototype._getMode = function (options) {
  return {
    scope: 'openid',
    response_type: this._getCallbackOnLocationHash(options) ? 'token' : 'code'
  };
};

Auth0.prototype._configureOfflineMode = function(options) {
  if (options.scope && options.scope.indexOf('offline_access') >= 0) {
    options.device = options.device || 'Browser';
  }
};

/**
 * Get user information from API
 *
 * @param {Object} profile
 * @param {String} id_token
 * @param {Function} callback
 * @private
 */

Auth0.prototype._getUserInfo = function (profile, id_token, callback) {

  if (!(profile && !profile.user_id)) {
    return callback(null, profile);
  }

  // the scope was just openid
  var _this = this;
  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/tokeninfo';
  var url = joinUrl(protocol, domain, endpoint);

  var fail = function (status, description) {
    var error = new Error(status + ': ' + (description || ''));

    // These two properties are added for compatibility with old versions (no Error instance was returned)
    error.error = status;
    error.error_description = description;

    callback(error);
  };

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify({id_token: id_token}), jsonpOpts, function (err, resp) {
      if (err) {
        return fail(0, err.toString());
      }

      return resp.status === 200 ?
        callback(null, resp.user) :
        fail(resp.status, resp.err || resp.error);
    });
  }

  return reqwest({
    url:          same_origin(protocol, domain) ? endpoint : url,
    method:       'post',
    type:         'json',
    crossOrigin:  !same_origin(protocol, domain),
    data:         {id_token: id_token}
  }).fail(function (err) {
    fail(err.status, err.responseText);
  }).then(function (userinfo) {
    callback(null, userinfo);
  });

};

/**
 * Get profile data by `id_token`
 *
 * @param {String} id_token
 * @param {Function} callback
 * @method getProfile
 */

Auth0.prototype.getProfile = function (id_token, callback) {
  if ('function' !== typeof callback) {
    throw new Error('A callback function is required');
  }
  if (!id_token || typeof id_token !== 'string') {
    return callback(new Error('Invalid token'));
  }

  this._getUserInfo(this.decodeJwt(id_token), id_token, callback);
};

/**
 * Validate a user
 *
 * @param {Object} options
 * @param {Function} callback
 * @method validateUser
 */

Auth0.prototype.validateUser = function (options, callback) {
  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/public/api/users/validate_userpassword';
  var url = joinUrl(protocol, domain, endpoint);

  var query = xtend(
    options,
    {
      client_id:    this._clientID,
      username:     trim(options.username || options.email || '')
    });

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify(query), jsonpOpts, function (err, resp) {
      if (err) {
        return callback(err);
      }
      if('error' in resp && resp.status !== 404) {
        return callback(new Error(resp.error));
      }
      callback(null, resp.status === 200);
    });
  }

  reqwest({
    url:     same_origin(protocol, domain) ? endpoint : url,
    method:  'post',
    type:    'text',
    data:    query,
    crossOrigin: !same_origin(protocol, domain),
    error: function (err) {
      if (err.status !== 404) { return callback(new Error(err.responseText)); }
      callback(null, false);
    },
    success: function (resp) {
      callback(null, resp.status === 200);
    }
  });
};

/**
 * Decode Json Web Token
 *
 * @param {String} jwt
 * @method decodeJwt
 */

Auth0.prototype.decodeJwt = function (jwt) {
  var encoded = jwt && jwt.split('.')[1];
  return json_parse(Base64Url.decode(encoded));
};

/**
 * Given the hash (or a query) of an URL returns a dictionary with only relevant
 * authentication information. If succeeds it will return the following fields:
 * `profile`, `id_token`, `access_token` and `state`. In case of error, it will
 * return `error` and `error_description`.
 *
 * @method parseHash
 * @param {String} [hash=window.location.hash] URL to be parsed
 * @example
 *      var auth0 = new Auth0({...});
 *
 *      // Returns {profile: {** decoded id token **}, state: "good"}
 *      auth0.parseHash('#id_token=.....&state=good&foo=bar');
 *
 *      // Returns {error: "invalid_credentials", error_description: undefined}
 *      auth0.parseHash('#error=invalid_credentials');
 *
 *      // Returns {error: "invalid_credentials", error_description: undefined}
 *      auth0.parseHash('?error=invalid_credentials');
 *
 */

Auth0.prototype.parseHash = function (hash) {
  hash = hash || window.location.hash;
  var parsed_qs;
  if (hash.match(/error/)) {
    hash = hash.substr(1).replace(/^\//, '');
    parsed_qs = qs.parse(hash);
    var err = {
      error: parsed_qs.error,
      error_description: parsed_qs.error_description
    };
    return err;
  }
  if(!hash.match(/access_token/)) {
    // Invalid hash URL
    return null;
  }
  hash = hash.substr(1).replace(/^\//, '');
  parsed_qs = qs.parse(hash);
  var id_token = parsed_qs.id_token;
  var refresh_token = parsed_qs.refresh_token;
  var prof = this.decodeJwt(id_token);
  var invalidJwt = function (error) {
    var err = {
      error: 'invalid_token',
      error_description: error
    };
    return err;
  };

  // aud should be the clientID
  var audiences = is_array(prof.aud) ? prof.aud : [ prof.aud ];
  if (index_of(audiences, this._clientID) === -1) {
    return invalidJwt(
      'The clientID configured (' + this._clientID + ') does not match with the clientID set in the token (' + audiences.join(', ') + ').');
  }

  // iss should be the Auth0 domain (i.e.: https://contoso.auth0.com/)
  if (prof.iss && prof.iss !== 'https://' + this._domain + '/') {
    return invalidJwt(
      'The domain configured (https://' + this._domain + '/) does not match with the domain set in the token (' + prof.iss + ').');
  }

  return {
    profile: prof,
    id_token: id_token,
    access_token: parsed_qs.access_token,
    state: parsed_qs.state,
    refresh_token: refresh_token
  };
};

/**
 * Signup
 *
 * @param {Object} options Signup Options
 * @param {String} email New user email
 * @param {String} password New user password
 *
 * @param {Function} callback
 * @method signup
 */

Auth0.prototype.signup = function (options, callback) {
  var _this = this;

  var opts = {
    client_id: this._clientID,
    redirect_uri: this._getCallbackURL(options),
    username: trim(options.username || ''),
    email: trim(options.email || options.username || ''),
    tenant: this._domain.split('.')[0]
  };

  var query = xtend(this._getMode(options), options, opts);

  this._configureOfflineMode(query);

  // TODO Change this to a property named 'disableSSO' for consistency.
  // By default, options.sso is true
  if (!checkIfSet(options, 'sso')) {
    options.sso = true;
  }

  if (!checkIfSet(options, 'auto_login')) {
    options.auto_login = true;
  }

  var popup;

  var will_popup = options.auto_login && options.popup
    && (!this._getCallbackOnLocationHash(options) || options.sso);

  if (will_popup) {
    popup = this._buildPopupWindow(options);
  }

  function success () {
    if (options.auto_login) {
      return _this.login(options, callback);
    }

    if ('function' === typeof callback) {
      return callback();
    }
  }

  function fail (status, resp) {
    var error = new LoginError(status, resp);

    // when failed we want the popup closed if opened
    if (popup && 'function' === typeof popup.kill) {
      popup.kill();
    }

    if ('function' === typeof callback) {
      return callback(error);
    }

    throw error;
  }

  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/dbconnections/signup';
  var url = joinUrl(protocol, domain, endpoint);

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify(query), jsonpOpts, function (err, resp) {
      if (err) {
        return fail(0, err);
      }

      return resp.status == 200 ? success() :
              fail(resp.status, resp.err || resp.error);
    });
  }

  reqwest({
    url:     same_origin(protocol, domain) ? endpoint : url,
    method:  'post',
    type:    'html',
    data:    query,
    success: success,
    crossOrigin: !same_origin(protocol, domain),
    error: function (err) {
      fail(err.status, err.responseText);
    }
  });
};

/**
 * Change password
 *
 * @param {Object} options
 * @param {Function} callback
 * @method changePassword
 */

Auth0.prototype.changePassword = function (options, callback) {
  var query = {
    tenant:         this._domain.split('.')[0],
    client_id:      this._clientID,
    connection:     options.connection,
    username:       trim(options.username || ''),
    email:          trim(options.email || options.username || ''),
    password:       options.password
  };


  function fail (status, resp) {
    var error = new LoginError(status, resp);
    if (callback) {
      return callback(error);
    }
  }

  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/dbconnections/change_password';
  var url = joinUrl(protocol, domain, endpoint);

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify(query), jsonpOpts, function (err, resp) {
      if (err) {
        return fail(0, err);
      }
      return resp.status == 200 ?
              callback(null, resp.message) :
              fail(resp.status, resp.err || resp.error);
    });
  }

  reqwest({
    url:     same_origin(protocol, domain) ? endpoint : url,
    method:  'post',
    type:    'html',
    data:    query,
    crossOrigin: !same_origin(protocol, domain),
    error: function (err) {
      fail(err.status, err.responseText);
    },
    success: function (r) {
      callback(null, r);
    }
  });
};

/**
 * Builds query string to be passed to /authorize based on dict key and values.
 *
 * @param {Array} args
 * @param {Array} blacklist
 * @private
 */

Auth0.prototype._buildAuthorizeQueryString = function (args, blacklist) {
  var query = this._buildAuthorizationParameters(args, blacklist);
  return qs.stringify(query);
};

/**
 * Builds parameter dictionary to be passed to /authorize based on dict key and values.
 *
 * @param {Array} args
 * @param {Array} blacklist
 * @private
 */

Auth0.prototype._buildAuthorizationParameters = function(args, blacklist) {
  var query = xtend.apply(null, args);

  // Adds offline mode to the query
  this._configureOfflineMode(query);

  // Adds client SDK information (when enabled)
  if ( this._sendClientInfo ) query['auth0Client'] = this._getClientInfoString();

  // Elements to filter from query string
  blacklist = blacklist || ['popup', 'popupOptions'];

  var i, key;

  for (i = 0; i < blacklist.length; i++) {
    key = blacklist[i];
    delete query[key];
  }

  if (query.connection_scope && is_array(query.connection_scope)){
    query.connection_scope = query.connection_scope.join(',');
  }

  return query;
};

/**
 * Login user
 *
 * @param {Object} options
 * @param {Function} callback
 * @method login
 */

Auth0.prototype.login = Auth0.prototype.signin = function (options, callback) {
  // TODO Change this to a property named 'disableSSO' for consistency.
  // By default, options.sso is true
  if (!checkIfSet(options, 'sso')) {
    options.sso = true;
  }

  if (typeof options.passcode !== 'undefined') {
    return this.loginWithPasscode(options, callback);
  }

  if (typeof options.username !== 'undefined' ||
      typeof options.email !== 'undefined') {
    return this.loginWithUsernamePassword(options, callback);
  }

  if (!!window.cordova) {
    return this.loginPhonegap(options, callback);
  }

  if (!!options.popup && this._getCallbackOnLocationHash(options)) {
    return this.loginWithPopup(options, callback);
  }

  this._authorize(options);
};

Auth0.prototype._authorize = function(options) {
  var qs = [
    this._getMode(options),
    options,
    {
      client_id: this._clientID,
      redirect_uri: this._getCallbackURL(options)
    }
  ];

  var query = this._buildAuthorizeQueryString(qs);

  var url = joinUrl('https:', this._domain, '/authorize?' + query);

  if (options.popup) {
    this._buildPopupWindow(options, url);
  } else {
    this._redirect(url);
  }
};

/**
 * Compute `options.width` and `options.height` for the popup to
 * open and return and extended object with optimal `top` and `left`
 * position arguments for the popup windows
 *
 * @param {Object} options
 * @private
 */

Auth0.prototype._computePopupPosition = function (options) {
  options = options || {};
  var width = options.width || 500;
  var height = options.height || 600;

  var screenX = typeof window.screenX !== 'undefined' ? window.screenX : window.screenLeft;
  var screenY = typeof window.screenY !== 'undefined' ? window.screenY : window.screenTop;
  var outerWidth = typeof window.outerWidth !== 'undefined' ? window.outerWidth : document.body.clientWidth;
  var outerHeight = typeof window.outerHeight !== 'undefined' ? window.outerHeight : (document.body.clientHeight - 22);
  // XXX: what is the 22?

  // Use `outerWidth - width` and `outerHeight - height` for help in
  // positioning the popup centered relative to the current window
  var left = screenX + (outerWidth - width) / 2;
  var top = screenY + (outerHeight - height) / 2;

  return { width: width, height: height, left: left, top: top };
};

/**
 * loginPhonegap method is triggered when !!window.cordova is true.
 *
 * @method loginPhonegap
 * @private
 * @param {Object}    options   Login options.
 * @param {Function}  callback  To be called after login happened. Callback arguments
 *                              should be:
 *                              function (err, profile, idToken, accessToken, state)
 *
 * @example
 *      var auth0 = new Auth0({ clientId: '...', domain: '...'});
 *
 *      auth0.signin({}, function (err, profile, idToken, accessToken, state) {
 *        if (err) {
 *         alert(err);
 *         return;
 *        }
 *
 *        alert('Welcome ' + profile.name);
 *      });
 */

Auth0.prototype.loginPhonegap = function (options, callback) {
  if (this._shouldAuthenticateWithCordovaPlugin(options.connection)) {
    this._socialPhonegapLogin(options, callback);
    return;
  }

  var mobileCallbackURL = joinUrl('https:', this._domain, '/mobile');
  var _this = this;
  var qs = [
    this._getMode(options),
    options,
    {
      client_id: this._clientID,
      redirect_uri: mobileCallbackURL
    }
  ];

  if ( this._sendClientInfo ) {
    qs.push({ auth0Client: this._getClientInfoString() });
  }

  var query = this._buildAuthorizeQueryString(qs);

  var popupUrl = joinUrl('https:', this._domain, '/authorize?' + query);

  var popupOptions = xtend({location: 'yes'} ,
    options.popupOptions);

  // This wasn't send before so we don't send it now either
  delete popupOptions.width;
  delete popupOptions.height;



  var ref = window.open(popupUrl, '_blank', stringifyPopupSettings(popupOptions));
  var answered = false;

  function errorHandler(event) {
    if (answered) { return; }
    callback(new Error(event.message), null, null, null, null);
    answered = true;
    return ref.close();
  }

  function startHandler(event) {
    if (answered) { return; }

    if ( event.url && !(event.url.indexOf(mobileCallbackURL + '#') === 0 ||
                       event.url.indexOf(mobileCallbackURL + '?') === 0)) { return; }

    var result = _this.parseHash(event.url.slice(mobileCallbackURL.length));

    if (!result) {
      callback(new Error('Error parsing hash'), null, null, null, null);
      answered = true;
      return ref.close();
    }

    if (result.id_token) {
      _this.getProfile(result.id_token, function (err, profile) {
        callback(err, profile, result.id_token, result.access_token, result.state, result.refresh_token);
      });
      answered = true;
      return ref.close();
    }

    // Case where we've found an error
    callback(new Error(result.err || result.error || 'Something went wrong'), null, null, null, null);
    answered = true;
    return ref.close();
  }

  function exitHandler() {
    if (answered) { return; }

    callback(new Error('Browser window closed'), null, null, null, null);

    ref.removeEventListener('loaderror', errorHandler);
    ref.removeEventListener('loadstart', startHandler);
    ref.removeEventListener('exit', exitHandler);
  }

  ref.addEventListener('loaderror', errorHandler);
  ref.addEventListener('loadstart', startHandler);
  ref.addEventListener('exit', exitHandler);

};

/**
 * loginWithPopup method is triggered when login method receives a {popup: true} in
 * the login options.
 *
 * @method loginWithPopup
 * @param {Object}   options    Login options.
 * @param {function} callback   To be called after login happened (whether
 *                              success or failure). This parameter is mandatory when
 *                              option callbackOnLocationHash is truthy but should not
 *                              be used when falsy.
 * @example
 *       var auth0 = new Auth0({ clientId: '...', domain: '...', callbackOnLocationHash: true });
 *
 *       // Error! No callback
 *       auth0.login({popup: true});
 *
 *       // Ok!
 *       auth0.login({popup: true}, function () { });
 *
 * @example
 *       var auth0 = new Auth0({ clientId: '...', domain: '...'});
 *
 *       // Ok!
 *       auth0.login({popup: true});
 *
 *       // Error! No callback will be executed on response_type=code
 *       auth0.login({popup: true}, function () { });
 * @private
 */

Auth0.prototype.loginWithPopup = function(options, callback) {
  var _this = this;

  if (!callback) {
    throw new Error('popup mode should receive a mandatory callback');
  }

  var qs = [this._getMode(options), options, { client_id: this._clientID, owp: true }];

  if (this._sendClientInfo) {
    qs.push({ auth0Client: this._getClientInfoString() });
  }

  var query = this._buildAuthorizeQueryString(qs);
  var popupUrl = joinUrl('https:', this._domain, '/authorize?' + query);

  var popupPosition = this._computePopupPosition(options.popupOptions);
  var popupOptions = xtend(popupPosition, options.popupOptions);

  var popup = WinChan.open({
    url: popupUrl,
    relay_url: 'https://' + this._domain + '/relay.html',
    window_features: stringifyPopupSettings(popupOptions)
  }, function (err, result) {
    // Eliminate `_current_popup` reference manually because
    // Winchan removes `.kill()` method from window and also
    // doesn't call `.kill()` by itself
    _this._current_popup = null;

    // Winchan always returns string errors, we wrap them inside Error objects
    if (err) {
      return callback(new LoginError(err), null, null, null, null, null);
    }

    // Handle edge case with generic error
    if (!result) {
      return callback(new LoginError('Something went wrong'), null, null, null, null, null);
    }

    // Handle profile retrieval from id_token and respond
    if (result.id_token) {
      return _this.getProfile(result.id_token, function (err, profile) {
        callback(err, profile, result.id_token, result.access_token, result.state, result.refresh_token);
      });
    }

    // Case where the error is returned at an `err` property from the result
    if (result.err) {
      return callback(new LoginError(result.err.status, result.err.details || result.err), null, null, null, null, null);
    }

    // Case for sso_dbconnection_popup returning error at result.error instead of result.err
    if (result.error) {
      return callback(new LoginError(result.status, result.details || result), null, null, null, null, null);
    }

    // Case we couldn't match any error, we return a generic one
    return callback(new LoginError('Something went wrong'), null, null, null, null, null);
  });

  popup.focus();
};

/**
 * _shouldAuthenticateWithCordovaPlugin method checks whether Auth0 is properly configured to
 * handle authentication of a social connnection using a phonegap plugin.
 *
 * @param {String}   connection    Name of the connection.
 * @private
 */

Auth0.prototype._shouldAuthenticateWithCordovaPlugin = function(connection) {
  var socialPlugin = this._cordovaSocialPlugins[connection];
  return this._useCordovaSocialPlugins && !!socialPlugin;
};

/**
 * _socialPhonegapLogin performs social authentication using a phonegap plugin
 *
 * @param {String}   connection   Name of the connection.
 * @param {function} callback     To be called after login happened (whether
 *                                success or failure).
 * @private
 */

Auth0.prototype._socialPhonegapLogin = function(options, callback) {
  var socialAuthentication = this._cordovaSocialPlugins[options.connection];
  var _this = this;
  socialAuthentication(options.connection_scope, function(error, accessToken, extras) {
    if (error) {
      callback(error, null, null, null, null);
      return;
    }
    var loginOptions = xtend({ access_token: accessToken }, options, extras);
    _this.loginWithSocialAccessToken(loginOptions, callback);
  });
};

/**
 * _phonegapFacebookLogin performs social authentication with Facebook using phonegap-facebook-plugin
 *
 * @param {Object}   scopes     FB scopes used to login. It can be an Array of String or a single String.
 *                              By default is ["public_profile"]
 * @param {function} callback   To be called after login happened (whether success or failure). It will
 *                              yield the accessToken and any extra information neeeded by Auth0 API
 *                              or an Error if the authentication fails. Callback should be:
 *                              function (err, accessToken, extras) { }
 * @private
 */

Auth0.prototype._phonegapFacebookLogin = function(scopes, callback) {
  if (!window.facebookConnectPlugin || !window.facebookConnectPlugin.login) {
    callback(new Error('missing plugin phonegap-facebook-plugin'), null, null);
    return;
  }

  var fbScopes;
  if (scopes && is_array(scopes)){
    fbScopes = scopes;
  } else if (scopes) {
    fbScopes = [scopes];
  } else {
    fbScopes = ['public_profile'];
  }
  window.facebookConnectPlugin.login(fbScopes, function (state) {
    callback(null, state.authResponse.accessToken, {});
  }, function(error) {
    callback(new Error(error), null, null);
  });
};

/**
 * This method handles the scenario where a db connection is used with
 * popup: true and sso: true.
 *
 * @private
 */
Auth0.prototype.loginWithUsernamePasswordAndSSO = function (options, callback) {
  var _this = this;
  var popupPosition = this._computePopupPosition(options.popupOptions);
  var popupOptions = xtend(popupPosition, options.popupOptions);

  var popup = WinChan.open({
    url: 'https://' + this._domain + '/sso_dbconnection_popup/' + this._clientID,
    relay_url: 'https://' + this._domain + '/relay.html',
    window_features: stringifyPopupSettings(popupOptions),
    popup: this._current_popup,
    params: {
      domain:                 this._domain,
      clientID:               this._clientID,
      options: {
        // TODO What happens with i18n?
        username:   options.username,
        password:   options.password,
        connection: options.connection,
        state:      options.state,
        scope:      options.scope
      }
    }
  }, function (err, result) {
    // Eliminate `_current_popup` reference manually because
    // Winchan removes `.kill()` method from window and also
    // doesn't call `.kill()` by itself
    _this._current_popup = null;

    // Winchan always returns string errors, we wrap them inside Error objects
    if (err) {
      return callback(new LoginError(err), null, null, null, null, null);
    }

    // Handle edge case with generic error
    if (!result) {
      return callback(new LoginError('Something went wrong'), null, null, null, null, null);
    }

    // Handle profile retrieval from id_token and respond
    if (result.id_token) {
      return _this.getProfile(result.id_token, function (err, profile) {
        callback(err, profile, result.id_token, result.access_token, result.state, result.refresh_token);
      });
    }

    // Case where the error is returned at an `err` property from the result
    if (result.err) {
      return callback(new LoginError(result.err.status, result.err.details || result.err), null, null, null, null, null);
    }

    // Case for sso_dbconnection_popup returning error at result.error instead of result.err
    if (result.error) {
      return callback(new LoginError(result.status, result.details || result), null, null, null, null, null);
    }

    // Case we couldn't match any error, we return a generic one
    return callback(new LoginError('Something went wrong'), null, null, null, null, null);
  });

  popup.focus();
};

/**
 * Login with Resource Owner (RO)
 *
 * @param {Object} options
 * @param {Function} callback
 * @method loginWithResourceOwner
 */

Auth0.prototype.loginWithResourceOwner = function (options, callback) {
  var _this = this;
  var query = xtend(
    this._getMode(options),
    options,
    {
      client_id:    this._clientID,
      username:     trim(options.username || options.email || ''),
      grant_type:   'password'
    });

  this._configureOfflineMode(query);

  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/oauth/ro';
  var url = joinUrl(protocol, domain, endpoint);

  if ( this._sendClientInfo && this._useJSONP ) {
    query['auth0Client'] = this._getClientInfoString();
  }

  function enrichGetProfile(resp, callback) {
    _this.getProfile(resp.id_token, function (err, profile) {
      callback(err, profile, resp.id_token, resp.access_token, resp.state, resp.refresh_token);
    });
  }

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify(query), jsonpOpts, function (err, resp) {
      if (err) {
        return callback(err);
      }
      if('error' in resp) {
        var error = new LoginError(resp.status, resp.error);
        return callback(error);
      }
      enrichGetProfile(resp, callback);
    });
  }

  reqwest({
    url:     same_origin(protocol, domain) ? endpoint : url,
    method:  'post',
    type:    'json',
    data:    query,
    headers: this._getClientInfoHeader(),
    crossOrigin: !same_origin(protocol, domain),
    success: function (resp) {
      enrichGetProfile(resp, callback);
    },
    error: function (err) {
      handleRequestError(err, callback);
    }
  });
};

/**
 * Login with Social Access Token
 *
 * @param {Object} options
 * @param {Function} callback
 * @method loginWithSocialAccessToken
 */

Auth0.prototype.loginWithSocialAccessToken = function (options, callback) {
  var _this = this;
  var query = this._buildAuthorizationParameters([
      { scope: 'openid' },
      options,
      { client_id: this._clientID }
    ]);

  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/oauth/access_token';
  var url = joinUrl(protocol, domain, endpoint);

  function enrichGetProfile(resp, callback) {
    _this.getProfile(resp.id_token, function (err, profile) {
      callback(err, profile, resp.id_token, resp.access_token, resp.state, resp.refresh_token);
    });
  }

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify(query), jsonpOpts, function (err, resp) {
      if (err) {
        return callback(err);
      }
      if('error' in resp) {
        var error = new LoginError(resp.status, resp.error);
        return callback(error);
      }
      enrichGetProfile(resp, callback);
    });
  }

  reqwest({
    url:     same_origin(protocol, domain) ? endpoint : url,
    method:  'post',
    type:    'json',
    data:    query,
    headers: this._getClientInfoHeader(),
    crossOrigin: !same_origin(protocol, domain),
    success: function (resp) {
      enrichGetProfile(resp, callback);
    },
    error: function (err) {
      handleRequestError(err, callback);
    }
  });
};

/**
 * Open a popup, store the winref in the instance and return it.
 *
 * We usually need to call this method before any ajax transaction in order
 * to prevent the browser to block the popup.
 *
 * @param  {[type]}   options  [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 * @private
 */

Auth0.prototype._buildPopupWindow = function (options, url) {
  if (this._current_popup && !this._current_popup.closed) {
    return this._current_popup;
  }

  url = url || 'about:blank'

  var _this = this;
  var defaults = { width: 500, height: 600 };
  var opts = xtend(defaults, options.popupOptions || {});
  var popupOptions = stringifyPopupSettings(opts);

  this._current_popup = window.open(url, 'auth0_signup_popup', popupOptions);

  if (!this._current_popup) {
    throw new Error('Popup window cannot not been created. Disable popup blocker or make sure to call Auth0 login or singup on an UI event.');
  }

  this._current_popup.kill = function () {
    this.close();
    _this._current_popup = null;
  };

  return this._current_popup;
};

/**
 * Login with Username and Password
 *
 * @param {Object} options
 * @param {Function} callback
 * @method loginWithUsernamePassword
 */

Auth0.prototype.loginWithUsernamePassword = function (options, callback) {
  // XXX: Warning: This check is whether callback arguments are
  // fn(err) case callback.length === 1 (a redirect should be performed) vs.
  // fn(err, profile, id_token, access_token, state) callback.length > 1 (no
  // redirect should be performed)
  //
  // Note: Phonegap/Cordova:
  // As the popup is launched using the InAppBrowser plugin the SSO cookie will
  // be set on the InAppBrowser browser. That's why the browser where the app runs
  // won't get the sso cookie. Therefore, we don't allow username password using
  // popup with sso: true in Cordova/Phonegap and we default to resource owner auth.
  if (callback && callback.length > 1 && (!options.sso || window.cordova)) {
    return this.loginWithResourceOwner(options, callback);
  }

  var _this = this;
  var popup;

  // TODO We should deprecate this, really hacky and confuses people.
  if (options.popup  && !this._getCallbackOnLocationHash(options)) {
    popup = this._buildPopupWindow(options);
  }

  // When a callback with more than one argument is specified and sso: true then
  // we open a popup and do authentication there.
  if (callback && callback.length > 1 && options.sso ) {
    return this.loginWithUsernamePasswordAndSSO(options, callback);
  }

  var query = xtend(
    this._getMode(options),
    options,
    {
      client_id: this._clientID,
      redirect_uri: this._getCallbackURL(options),
      username: trim(options.username || options.email || ''),
      tenant: this._domain.split('.')[0]
    });

  this._configureOfflineMode(query);

  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/usernamepassword/login';
  var url = joinUrl(protocol, domain, endpoint);

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify(query), jsonpOpts, function (err, resp) {
      if (err) {
        if (popup && popup.kill) { popup.kill(); }
        return callback(err);
      }
      if('error' in resp) {
        if (popup && popup.kill) { popup.kill(); }
        var error = new LoginError(resp.status, resp.error);
        return callback(error);
      }
      _this._renderAndSubmitWSFedForm(options, resp.form);
    });
  }

  function return_error (error) {
    if (callback) {
      return callback(error);
    }
    throw error;
  }

  reqwest({
    url:     same_origin(protocol, domain) ? endpoint : url,
    method:  'post',
    type:    'html',
    data:    query,
    headers: this._getClientInfoHeader(),
    crossOrigin: !same_origin(protocol, domain),
    success: function (resp) {
      _this._renderAndSubmitWSFedForm(options, resp);
    },
    error: function (err) {
      if (popup && popup.kill) {
        popup.kill();
      }
      handleRequestError(err, return_error);
    }
  });
};

/**
 * Login with phone number and passcode
 *
 * @param {Object} options
 * @param {Function} callback
 * @method loginWithPhoneNumber
 */
Auth0.prototype.loginWithPasscode = function (options, callback) {

  if (options.email == null && options.phoneNumber == null) {
    throw new Error('email or phoneNumber is required for authentication');
  }

  if (options.passcode == null) {
    throw new Error('passcode is required for authentication');
  }

  options.connection = options.email == null ? 'sms' : 'email';

  if (!this._shouldRedirect) {
    options = xtend(options, {
      username: options.email == null ? options.phoneNumber : options.email,
      password: options.passcode,
      sso: false
    });

    delete options.email;
    delete options.phoneNumber;
    delete options.passcode;

    return this.loginWithResourceOwner(options, callback);
  }

  var verifyOptions = {connection: options.connection};

  if (options.phoneNumber) {
    options.phone_number = options.phoneNumber;
    delete options.phoneNumber;

    verifyOptions.phone_number = options.phone_number;
  }

  if (options.email) {
    verifyOptions.email = options.email;
  }

  options.verification_code = options.passcode;
  delete options.passcode;

  verifyOptions.verification_code = options.verification_code;

  var _this = this;
  this._verify(verifyOptions, function(error) {
    if (error) {
      return callback(error);
    }
    _this._verify_redirect(options);
  });
};

Auth0.prototype._verify = function(options, callback) {
  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/passwordless/verify';
  var url = joinUrl(protocol, domain, endpoint);

  var data = options;

  if (this._useJSONP) {
    if (this._sendClientInfo) {
      data['auth0Client'] = this._getClientInfoString();
    }

    return jsonp(url + '?' + qs.stringify(data), jsonpOpts, function (err, resp) {
      if (err) {
        return callback(new Error(0 + ': ' + err.toString()));
      }
      // /**/ typeof __auth0jp0 === 'function' && __auth0jp0({"status":400});
      return resp.status === 200 ? callback(null, true) : callback({status: resp.status});
    });
  }

  return reqwest({
    url:          same_origin(protocol, domain) ? endpoint : url,
    method:       'post',
    headers:      this._getClientInfoHeader(),
    crossOrigin:  !same_origin(protocol, domain),
    data:         data
  })
  .fail(function (err) {
    try {
      callback(JSON.parse(err.responseText));
    } catch (e) {
      var error = new Error(err.status + '(' + err.statusText + '): ' + err.responseText);
      error.statusCode = err.status;
      error.error = err.statusText;
      error.message = err.responseText;
      callback(error);
    }
  })
  .then(function (result) {
    callback(null, result);
  });
}

Auth0.prototype._verify_redirect = function(options) {
  var qs = [
    this._getMode(options),
    options,
    {
      client_id: this._clientID,
      redirect_uri: this._getCallbackURL(options)
    }
  ];

  var query = this._buildAuthorizeQueryString(qs);
  var url = joinUrl('https:', this._domain, '/passwordless/verify_redirect?' + query);

  this._redirect(url);
};

// TODO Document me
Auth0.prototype.renewIdToken = function (id_token, callback) {
  this.getDelegationToken({
    id_token: id_token,
    scope: 'passthrough',
    api: 'auth0'
  }, callback);
};

// TODO Document me
Auth0.prototype.refreshToken = function (refresh_token, callback) {
  this.getDelegationToken({
    refresh_token: refresh_token,
    scope: 'passthrough',
    api: 'auth0'
  }, callback);
};

/**
 * Get delegation token for certain addon or certain other clientId
 *
 * @example
 *
 *     auth0.getDelegationToken({
 *      id_token:   '<user-id-token>',
 *      target:     '<app-client-id>'
 *      api_type: 'auth0'
 *     }, function (err, delegationResult) {
 *        if (err) return console.log(err.message);
 *        // Do stuff with delegation token
 *        expect(delegationResult.id_token).to.exist;
 *        expect(delegationResult.token_type).to.eql('Bearer');
 *        expect(delegationResult.expires_in).to.eql(36000);
 *     });
 *
 * @example
 *
 *      // get a delegation token from a Firebase API App
  *     auth0.getDelegationToken({
 *      id_token:   '<user-id-token>',
 *      target:     '<app-client-id>'
 *      api_type: 'firebase'
 *     }, function (err, delegationResult) {
 *      // Use your firebase token here
 *    });
 *
 * @method getDelegationToken
 * @param {Object} [options]
 * @param {String} [id_token]
 * @param {String} [target]
 * @param {String} [api_type]
 * @param {Function} [callback]
 */
Auth0.prototype.getDelegationToken = function (options, callback) {
  options = options || {};

  if (!options.id_token && !options.refresh_token ) {
    throw new Error('You must send either an id_token or a refresh_token to get a delegation token.');
  }

  var query = xtend({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id:  this._clientID,
    target: options.targetClientId || this._clientID,
    api_type: options.api
  }, options);

  delete query.hasOwnProperty;
  delete query.targetClientId;
  delete query.api;

  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/delegation';
  var url = joinUrl(protocol, domain, endpoint);

  if (this._useJSONP) {
    return jsonp(url + '?' + qs.stringify(query), jsonpOpts, function (err, resp) {
      if (err) {
        return callback(err);
      }
      if('error' in resp) {
        var error = new LoginError(resp.status, resp.error_description || resp.error);
        return callback(error);
      }
      callback(null, resp);
    });
  }

  reqwest({
    url:     same_origin(protocol, domain) ? endpoint : url,
    method:  'post',
    type:    'json',
    data:    query,
    crossOrigin: !same_origin(protocol, domain),
    success: function (resp) {
      callback(null, resp);
    },
    error: function (err) {
      try {
        callback(JSON.parse(err.responseText));
      }
      catch (e) {
        var er = err;
        var isAffectedIEVersion = isInternetExplorer() === 10 || isInternetExplorer() === 11;
        var zeroStatus = (!er.status || er.status === 0);

        // Request failed because we are offline.
        // See: http://caniuse.com/#search=navigator.onLine
        if (zeroStatus && !window.navigator.onLine) {
          er = {};
          er.status = 0;
          er.responseText = {
            code: 'offline'
          };
        // http://stackoverflow.com/questions/23229723/ie-10-11-cors-status-0
        // XXX IE10 when a request fails in CORS returns status code 0
        // XXX This is not handled by handleRequestError as the errors are different
        } else if (zeroStatus && isAffectedIEVersion) {
          er = {};
          er.status = 401;
          er.responseText = {
            code: 'invalid_operation'
          };
        // If not IE10/11 and not offline it means that Auth0 host is unreachable:
        // Connection Timeout or Connection Refused.
        } else if (zeroStatus) {
          er = {};
          er.status = 0;
          er.responseText = {
            code: 'connection_refused_timeout'
          };
        } else {
          er.responseText = err;
        }
        callback(new LoginError(er.status, er.responseText));
      }
    }
  });
};

/**
 * Trigger logout redirect with
 * params from `query` object
 *
 * @example
 *
 *     auth0.logout();
 *     // redirects to -> 'https://yourapp.auth0.com/logout'
 *
 * @example
 *
 *     auth0.logout({returnTo: 'http://logout'});
 *     // redirects to -> 'https://yourapp.auth0.com/logout?returnTo=http://logout'
 *
 * @method logout
 * @param {Object} query
 */

Auth0.prototype.logout = function (query) {
  var url = joinUrl('https:', this._domain, '/logout');
  if (query) {
    url += '?' + qs.stringify(query);
  }
  this._redirect(url);
};

/**
 * Get single sign on Data
 *
 * @example
 *
 *     auth0.getSSOData(function (err, ssoData) {
 *       if (err) return console.log(err.message);
 *       expect(ssoData.sso).to.exist;
 *     });
 *
 * @example
 *
 *     auth0.getSSOData(false, fn);
 *
 * @method getSSOData
 * @param {Boolean} withActiveDirectories
 * @param {Function} callback
 */

Auth0.prototype.getSSOData = function (withActiveDirectories, callback) {
  if (typeof withActiveDirectories === 'function') {
    callback = withActiveDirectories;
    withActiveDirectories = false;
  }

  var url = joinUrl('https:', this._domain, '/user/ssodata');

  if (withActiveDirectories) {
    url += '?' + qs.stringify({ldaps: 1, client_id: this._clientID});
  }

  // override timeout
  var jsonpOptions = xtend({}, jsonpOpts, { timeout: 3000 });

  return jsonp(url, jsonpOptions, function (err, resp) {
    callback(null, err ? {sso:false} : resp); // Always return OK, regardless of any errors
  });
};

/**
 * Get all configured connections for a client
 *
 * @example
 *
 *     auth0.getConnections(function (err, conns) {
 *       if (err) return console.log(err.message);
 *       expect(conns.length).to.be.above(0);
 *       expect(conns[0].name).to.eql('Apprenda.com');
 *       expect(conns[0].strategy).to.eql('adfs');
 *       expect(conns[0].status).to.eql(false);
 *       expect(conns[0].domain).to.eql('Apprenda.com');
 *       expect(conns[0].domain_aliases).to.eql(['Apprenda.com', 'foo.com', 'bar.com']);
 *     });
 *
 * @method getConnections
 * @param {Function} callback
 */
// XXX We may change the way this method works in the future to use client's s3 file.

Auth0.prototype.getConnections = function (callback) {
  return jsonp('https://' + this._domain + '/public/api/' + this._clientID + '/connections', jsonpOpts, callback);
};

/**
 * Send email or SMS to do passwordless authentication
 *
 * @example
 *     // To send an email
 *     auth0.startPasswordless({email: 'foo@bar.com'}, function (err, result) {
 *       if (err) return console.log(err.error_description);
 *       console.log(result);
 *     });
 *
 * @example
 *     // To send a SMS
 *     auth0.startPasswordless({phoneNumber: '+14251112222'}, function (err, result) {
 *       if (err) return console.log(err.error_description);
 *       console.log(result);
 *     });
 *
 * @method startPasswordless
 * @param {Object} options
 * @param {Function} callback
 */

Auth0.prototype.startPasswordless = function (options, callback) {
  if ('object' !== typeof options) {
    throw new Error('An options object is required');
  }
  if ('function' !== typeof callback) {
    throw new Error('A callback function is required');
  }
  if (!options.email && !options.phoneNumber) {
    throw new Error('An `email` or a `phoneNumber` is required.');
  }

  var protocol = 'https:';
  var domain = this._domain;
  var endpoint = '/passwordless/start';
  var url = joinUrl(protocol, domain, endpoint);

  var data = {client_id: this._clientID};
  if (options.email) {
    data.email = options.email;
    data.connection = 'email';
    if (options.authParams) {
      data.authParams = options.authParams;
    }

    if (!options.send || options.send === "link") {
      if (!data.authParams) {
        data.authParams = {};
      }

      data.authParams.redirect_uri = this._callbackURL;
      data.authParams.response_type = this._shouldRedirect && !this._callbackOnLocationHash ?
        "code" : "token";
    }

    if (options.send) {
      data.send = options.send;
    }
  } else {
    data.phone_number = options.phoneNumber;
    data.connection = 'sms';
  }

  if (this._useJSONP) {
    if (this._sendClientInfo) {
      data['auth0Client'] = this._getClientInfoString();
    }

    return jsonp(url + '?' + qs.stringify(data), jsonpOpts, function (err, resp) {
      if (err) {
        return callback(new Error(0 + ': ' + err.toString()));
      }
      return resp.status === 200 ? callback(null, true) : callback(resp.err || resp.error);
    });
  }

  return reqwest({
    url:          same_origin(protocol, domain) ? endpoint : url,
    method:       'post',
    type:         'json',
    headers:      this._getClientInfoHeader(),
    crossOrigin:  !same_origin(protocol, domain),
    data:         data
  })
  .fail(function (err) {
    try {
      callback(JSON.parse(err.responseText));
    } catch (e) {
      var error = new Error(err.status + '(' + err.statusText + '): ' + err.responseText);
      error.statusCode = err.status;
      error.error = err.statusText;
      error.message = err.responseText;
      callback(error);
    }
  })
  .then(function (result) {
    callback(null, result);
  });
};

Auth0.prototype.requestMagicLink = function(attrs, cb) {
  return this.startPasswordless(attrs, cb);
};

Auth0.prototype.requestEmailCode = function(attrs, cb) {
  attrs.send = "code";
  return this.startPasswordless(attrs, cb);
};

Auth0.prototype.verifyEmailCode = function(attrs, cb) {
  attrs.passcode = attrs.code;
  delete attrs.code;
  return this.login(attrs, cb);
};

Auth0.prototype.requestSMSCode = function(attrs, cb) {
  return this.startPasswordless(attrs, cb);
};

Auth0.prototype.verifySMSCode = function(attrs, cb) {
  attrs.passcode = attrs.code;
  delete attrs.code;
  return this.login(attrs, cb);
};

/**
 * Expose `Auth0` constructor
 */

module.exports = Auth0;

},{"./lib/LoginError":2,"./lib/assert_required":3,"./lib/base64_url":4,"./lib/index-of":5,"./lib/is-array":6,"./lib/json-parse":7,"./lib/same-origin":8,"./lib/use_jsonp":9,"./version.json":27,"jsonp":15,"qs":16,"reqwest":17,"trim":18,"winchan":19,"xtend":21}],2:[function(require,module,exports){
/**
 * Module dependencies.
 */

var json_parse = require('./json-parse');

/**
 * Expose `LoginError`
 */

module.exports = LoginError;

/**
 * Create a `LoginError` by extend of `Error`
 *
 * @param {Number} status
 * @param {String} details
 * @public
 */

function LoginError(status, details) {
  var obj;

  if (typeof details == 'string') {
    try {
      obj = json_parse(details);
    } catch (er) {
      obj = { message: details };
    }
  } else {
    obj = details || { description: 'server error' };
  }

  if (!obj.code) {
    obj.code = obj.error;
  }

  if ('unauthorized' === obj.code) {
    status = 401;
  }

  var err = Error.call(this, obj.description || obj.message || obj.error);

  err.status = status;
  err.name = obj.code;
  err.code = obj.code;
  err.details = obj;

  if (status === 0) {
    if (!err.code || err.code !== 'offline') {
      err.code = 'Unknown';
      err.message = 'Unknown error.';
    }
  }

  return err;
}

/**
 * Extend `LoginError.prototype` with `Error.prototype`
 * and `LoginError` as constructor
 */

if (Object && Object.create) {
  LoginError.prototype = Object.create(Error.prototype, {
    constructor: { value: LoginError }
  });
}

},{"./json-parse":7}],3:[function(require,module,exports){
/**
 * Expose `required`
 */

module.exports = required;

/**
 * Assert `prop` as requirement of `obj`
 *
 * @param {Object} obj
 * @param {prop} prop
 * @public
 */

function required (obj, prop) {
  if (!obj[prop]) {
    throw new Error(prop + ' is required.');
  }
}

},{}],4:[function(require,module,exports){
/**
 * Module dependencies.
 */

var Base64 = require('Base64');

/**
 * Expose `base64_url_decode`
 */

module.exports = {
  encode: encode,
  decode: decode
};

/**
 * Encode a `base64` `encodeURIComponent` string
 *
 * @param {string} str
 * @public
 */

function encode(str) {
  return Base64.btoa(str)
      .replace(/\+/g, '-') // Convert '+' to '-'
      .replace(/\//g, '_') // Convert '/' to '_'
      .replace(/=+$/, ''); // Remove ending '='
}

/**
 * Decode a `base64` `encodeURIComponent` string
 *
 * @param {string} str
 * @public
 */

function decode(str) {
  // Add removed at end '='
  str += Array(5 - str.length % 4).join('=');

  str = str
    .replace(/\-/g, '+') // Convert '-' to '+'
    .replace(/\_/g, '/'); // Convert '_' to '/'

  return Base64.atob(str);
}
},{"Base64":10}],5:[function(require,module,exports){
/**
 * Resolve `isArray` as native or fallback
 */

module.exports = Array.prototype.indexOf
  ? nativeIndexOf
  : polyfillIndexOf;


function nativeIndexOf(array, searchElement, fromIndex) {
  return array.indexOf(searchElement, fromIndex);
}


function polyfillIndexOf(array, searchElement, fromIndex) {
  // Production steps of ECMA-262, Edition 5, 15.4.4.14
  // Reference: http://es5.github.io/#x15.4.4.14

  var k;

  // 1. Let O be the result of calling ToObject passing
  //    the array value as the argument.
  if (array == null) {
    throw new TypeError('"array" is null or not defined');
  }

  var O = Object(array);

  // 2. Let lenValue be the result of calling the Get
  //    internal method of O with the argument "length".
  // 3. Let len be ToUint32(lenValue).
  var len = O.length >>> 0;

  // 4. If len is 0, return -1.
  if (len === 0) {
    return -1;
  }

  // 5. If argument fromIndex was passed let n be
  //    ToInteger(fromIndex); else let n be 0.
  var n = +fromIndex || 0;

  if (Math.abs(n) === Infinity) {
    n = 0;
  }

  // 6. If n >= len, return -1.
  if (n >= len) {
    return -1;
  }

  // 7. If n >= 0, then Let k be n.
  // 8. Else, n<0, Let k be len - abs(n).
  //    If k is less than 0, then let k be 0.
  k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

  // 9. Repeat, while k < len
  while (k < len) {
    // a. Let Pk be ToString(k).
    //   This is implicit for LHS operands of the in operator
    // b. Let kPresent be the result of calling the
    //    HasProperty internal method of O with argument Pk.
    //   This step can be combined with c
    // c. If kPresent is true, then
    //    i.  Let elementK be the result of calling the Get
    //        internal method of O with the argument ToString(k).
    //   ii.  Let same be the result of applying the
    //        Strict Equality Comparison Algorithm to
    //        searchElement and elementK.
    //  iii.  If same is true, return k.
    if (k in O && O[k] === searchElement) {
      return k;
    }
    k++;
  }
  return -1;
};

},{}],6:[function(require,module,exports){
/**
 * Module dependencies.
 */

var toString = Object.prototype.toString;

/**
 * Resolve `isArray` as native or fallback
 */

module.exports = null != Array.isArray
  ? Array.isArray
  : isArray;

/**
 * Wrap `Array.isArray` Polyfill for IE9
 * source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/isArray
 *
 * @param {Array} array
 * @public
 */

function isArray (array) {
  return toString.call(array) === '[object Array]';
};

},{}],7:[function(require,module,exports){
/**
 * Expose `JSON.parse` method or fallback if not
 * exists on `window`
 */

module.exports = 'undefined' === typeof window.JSON
  ? require('json-fallback').parse
  : window.JSON.parse;

},{"json-fallback":14}],8:[function(require,module,exports){
/**
 * Check for same origin policy
 */

var protocol = window.location.protocol;
var domain = window.location.hostname;
var port = window.location.port;

module.exports = same_origin;

function same_origin (tprotocol, tdomain, tport) {
  tport = tport || '';
  return protocol === tprotocol && domain === tdomain && port === tport;
}

},{}],9:[function(require,module,exports){
/**
 * Expose `use_jsonp`
 */

module.exports = use_jsonp;

/**
 * Return true if `jsonp` is required
 *
 * @return {Boolean}
 * @public
 */

function use_jsonp() {
  var xhr = window.XMLHttpRequest ? new XMLHttpRequest() : null;

  if (xhr && 'withCredentials' in xhr) {
    return false;
  }

  // We no longer support XDomainRequest for IE8 and IE9 for CORS because it has many quirks.
  // if ('XDomainRequest' in window && window.location.protocol === 'https:') {
  //   return false;
  // }

  return true;
}
},{}],10:[function(require,module,exports){
;(function () {

  var
    object = typeof exports != 'undefined' ? exports : this, // #8: web workers
    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
    INVALID_CHARACTER_ERR = (function () {
      // fabricate a suitable error object
      try { document.createElement('$'); }
      catch (error) { return error; }}());

  // encoder
  // [https://gist.github.com/999166] by [https://github.com/nignag]
  object.btoa || (
  object.btoa = function (input) {
    for (
      // initialize result and counter
      var block, charCode, idx = 0, map = chars, output = '';
      // if the next input index does not exist:
      //   change the mapping table to "="
      //   check if d has no fractional digits
      input.charAt(idx | 0) || (map = '=', idx % 1);
      // "8 - idx % 1 * 8" generates the sequence 2, 4, 6, 8
      output += map.charAt(63 & block >> 8 - idx % 1 * 8)
    ) {
      charCode = input.charCodeAt(idx += 3/4);
      if (charCode > 0xFF) throw INVALID_CHARACTER_ERR;
      block = block << 8 | charCode;
    }
    return output;
  });

  // decoder
  // [https://gist.github.com/1020396] by [https://github.com/atk]
  object.atob || (
  object.atob = function (input) {
    input = input.replace(/=+$/, '')
    if (input.length % 4 == 1) throw INVALID_CHARACTER_ERR;
    for (
      // initialize result and counters
      var bc = 0, bs, buffer, idx = 0, output = '';
      // get next character
      buffer = input.charAt(idx++);
      // character found in table? initialize bit storage and add its ascii value;
      ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
        // and if not first of each 4 characters,
        // convert the first 8 bits to one ascii character
        bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
    ) {
      // try to find character in table (0-63, not found => -1)
      buffer = chars.indexOf(buffer);
    }
    return output;
  });

}());

},{}],11:[function(require,module,exports){

/**
 * This is the web browser implementation of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = require('./debug');
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;

/**
 * Colors.
 */

exports.colors = [
  'lightseagreen',
  'forestgreen',
  'goldenrod',
  'dodgerblue',
  'darkorchid',
  'crimson'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

function useColors() {
  // is webkit? http://stackoverflow.com/a/16459606/376773
  return ('WebkitAppearance' in document.documentElement.style) ||
    // is firebug? http://stackoverflow.com/a/398120/376773
    (window.console && (console.firebug || (console.exception && console.table))) ||
    // is firefox >= v31?
    // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
    (navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31);
}

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

exports.formatters.j = function(v) {
  return JSON.stringify(v);
};


/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs() {
  var args = arguments;
  var useColors = this.useColors;

  args[0] = (useColors ? '%c' : '')
    + this.namespace
    + (useColors ? ' %c' : ' ')
    + args[0]
    + (useColors ? '%c ' : ' ')
    + '+' + exports.humanize(this.diff);

  if (!useColors) return args;

  var c = 'color: ' + this.color;
  args = [args[0], c, 'color: inherit'].concat(Array.prototype.slice.call(args, 1));

  // the final "%c" is somewhat tricky, because there could be other
  // arguments passed either before or after the %c, so we need to
  // figure out the correct index to insert the CSS into
  var index = 0;
  var lastC = 0;
  args[0].replace(/%[a-z%]/g, function(match) {
    if ('%%' === match) return;
    index++;
    if ('%c' === match) {
      // we only are interested in the *last* %c
      // (the user may have provided their own)
      lastC = index;
    }
  });

  args.splice(lastC, 0, c);
  return args;
}

/**
 * Invokes `console.log()` when available.
 * No-op when `console.log` is not a "function".
 *
 * @api public
 */

function log() {
  // This hackery is required for IE8,
  // where the `console.log` function doesn't have 'apply'
  return 'object' == typeof console
    && 'function' == typeof console.log
    && Function.prototype.apply.call(console.log, console, arguments);
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */

function save(namespaces) {
  try {
    if (null == namespaces) {
      localStorage.removeItem('debug');
    } else {
      localStorage.debug = namespaces;
    }
  } catch(e) {}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
  var r;
  try {
    r = localStorage.debug;
  } catch(e) {}
  return r;
}

/**
 * Enable namespaces listed in `localStorage.debug` initially.
 */

exports.enable(load());

},{"./debug":12}],12:[function(require,module,exports){

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 *
 * Expose `debug()` as the module.
 */

exports = module.exports = debug;
exports.coerce = coerce;
exports.disable = disable;
exports.enable = enable;
exports.enabled = enabled;
exports.humanize = require('ms');

/**
 * The currently active debug mode names, and names to skip.
 */

exports.names = [];
exports.skips = [];

/**
 * Map of special "%n" handling functions, for the debug "format" argument.
 *
 * Valid key names are a single, lowercased letter, i.e. "n".
 */

exports.formatters = {};

/**
 * Previously assigned color.
 */

var prevColor = 0;

/**
 * Previous log timestamp.
 */

var prevTime;

/**
 * Select a color.
 *
 * @return {Number}
 * @api private
 */

function selectColor() {
  return exports.colors[prevColor++ % exports.colors.length];
}

/**
 * Create a debugger with the given `namespace`.
 *
 * @param {String} namespace
 * @return {Function}
 * @api public
 */

function debug(namespace) {

  // define the `disabled` version
  function disabled() {
  }
  disabled.enabled = false;

  // define the `enabled` version
  function enabled() {

    var self = enabled;

    // set `diff` timestamp
    var curr = +new Date();
    var ms = curr - (prevTime || curr);
    self.diff = ms;
    self.prev = prevTime;
    self.curr = curr;
    prevTime = curr;

    // add the `color` if not set
    if (null == self.useColors) self.useColors = exports.useColors();
    if (null == self.color && self.useColors) self.color = selectColor();

    var args = Array.prototype.slice.call(arguments);

    args[0] = exports.coerce(args[0]);

    if ('string' !== typeof args[0]) {
      // anything else let's inspect with %o
      args = ['%o'].concat(args);
    }

    // apply any `formatters` transformations
    var index = 0;
    args[0] = args[0].replace(/%([a-z%])/g, function(match, format) {
      // if we encounter an escaped % then don't increase the array index
      if (match === '%%') return match;
      index++;
      var formatter = exports.formatters[format];
      if ('function' === typeof formatter) {
        var val = args[index];
        match = formatter.call(self, val);

        // now we need to remove `args[index]` since it's inlined in the `format`
        args.splice(index, 1);
        index--;
      }
      return match;
    });

    if ('function' === typeof exports.formatArgs) {
      args = exports.formatArgs.apply(self, args);
    }
    var logFn = enabled.log || exports.log || console.log.bind(console);
    logFn.apply(self, args);
  }
  enabled.enabled = true;

  var fn = exports.enabled(namespace) ? enabled : disabled;

  fn.namespace = namespace;

  return fn;
}

/**
 * Enables a debug mode by namespaces. This can include modes
 * separated by a colon and wildcards.
 *
 * @param {String} namespaces
 * @api public
 */

function enable(namespaces) {
  exports.save(namespaces);

  var split = (namespaces || '').split(/[\s,]+/);
  var len = split.length;

  for (var i = 0; i < len; i++) {
    if (!split[i]) continue; // ignore empty strings
    namespaces = split[i].replace(/\*/g, '.*?');
    if (namespaces[0] === '-') {
      exports.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
    } else {
      exports.names.push(new RegExp('^' + namespaces + '$'));
    }
  }
}

/**
 * Disable debug output.
 *
 * @api public
 */

function disable() {
  exports.enable('');
}

/**
 * Returns true if the given mode name is enabled, false otherwise.
 *
 * @param {String} name
 * @return {Boolean}
 * @api public
 */

function enabled(name) {
  var i, len;
  for (i = 0, len = exports.skips.length; i < len; i++) {
    if (exports.skips[i].test(name)) {
      return false;
    }
  }
  for (i = 0, len = exports.names.length; i < len; i++) {
    if (exports.names[i].test(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Coerce `val`.
 *
 * @param {Mixed} val
 * @return {Mixed}
 * @api private
 */

function coerce(val) {
  if (val instanceof Error) return val.stack || val.message;
  return val;
}

},{"ms":13}],13:[function(require,module,exports){
/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} options
 * @return {String|Number}
 * @api public
 */

module.exports = function(val, options){
  options = options || {};
  if ('string' == typeof val) return parse(val);
  return options.long
    ? long(val)
    : short(val);
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  var match = /^((?:\d+)?\.?\d+) *(ms|seconds?|s|minutes?|m|hours?|h|days?|d|years?|y)?$/i.exec(str);
  if (!match) return;
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'y':
      return n * y;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 's':
      return n * s;
    case 'ms':
      return n;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function short(ms) {
  if (ms >= d) return Math.round(ms / d) + 'd';
  if (ms >= h) return Math.round(ms / h) + 'h';
  if (ms >= m) return Math.round(ms / m) + 'm';
  if (ms >= s) return Math.round(ms / s) + 's';
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function long(ms) {
  return plural(ms, d, 'day')
    || plural(ms, h, 'hour')
    || plural(ms, m, 'minute')
    || plural(ms, s, 'second')
    || ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, n, name) {
  if (ms < n) return;
  if (ms < n * 1.5) return Math.floor(ms / n) + ' ' + name;
  return Math.ceil(ms / n) + ' ' + name + 's';
}

},{}],14:[function(require,module,exports){
/*
    json2.js
    2011-10-19

    Public Domain.

    NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.

    See http://www.JSON.org/js.html


    This code should be minified before deployment.
    See http://javascript.crockford.com/jsmin.html

    USE YOUR OWN COPY. IT IS EXTREMELY UNWISE TO LOAD CODE FROM SERVERS YOU DO
    NOT CONTROL.


    This file creates a global JSON object containing two methods: stringify
    and parse.

        JSON.stringify(value, replacer, space)
            value       any JavaScript value, usually an object or array.

            replacer    an optional parameter that determines how object
                        values are stringified for objects. It can be a
                        function or an array of strings.

            space       an optional parameter that specifies the indentation
                        of nested structures. If it is omitted, the text will
                        be packed without extra whitespace. If it is a number,
                        it will specify the number of spaces to indent at each
                        level. If it is a string (such as '\t' or '&nbsp;'),
                        it contains the characters used to indent at each level.

            This method produces a JSON text from a JavaScript value.

            When an object value is found, if the object contains a toJSON
            method, its toJSON method will be called and the result will be
            stringified. A toJSON method does not serialize: it returns the
            value represented by the name/value pair that should be serialized,
            or undefined if nothing should be serialized. The toJSON method
            will be passed the key associated with the value, and this will be
            bound to the value

            For example, this would serialize Dates as ISO strings.

                Date.prototype.toJSON = function (key) {
                    function f(n) {
                        // Format integers to have at least two digits.
                        return n < 10 ? '0' + n : n;
                    }

                    return this.getUTCFullYear()   + '-' +
                         f(this.getUTCMonth() + 1) + '-' +
                         f(this.getUTCDate())      + 'T' +
                         f(this.getUTCHours())     + ':' +
                         f(this.getUTCMinutes())   + ':' +
                         f(this.getUTCSeconds())   + 'Z';
                };

            You can provide an optional replacer method. It will be passed the
            key and value of each member, with this bound to the containing
            object. The value that is returned from your method will be
            serialized. If your method returns undefined, then the member will
            be excluded from the serialization.

            If the replacer parameter is an array of strings, then it will be
            used to select the members to be serialized. It filters the results
            such that only members with keys listed in the replacer array are
            stringified.

            Values that do not have JSON representations, such as undefined or
            functions, will not be serialized. Such values in objects will be
            dropped; in arrays they will be replaced with null. You can use
            a replacer function to replace those with JSON values.
            JSON.stringify(undefined) returns undefined.

            The optional space parameter produces a stringification of the
            value that is filled with line breaks and indentation to make it
            easier to read.

            If the space parameter is a non-empty string, then that string will
            be used for indentation. If the space parameter is a number, then
            the indentation will be that many spaces.

            Example:

            text = JSON.stringify(['e', {pluribus: 'unum'}]);
            // text is '["e",{"pluribus":"unum"}]'


            text = JSON.stringify(['e', {pluribus: 'unum'}], null, '\t');
            // text is '[\n\t"e",\n\t{\n\t\t"pluribus": "unum"\n\t}\n]'

            text = JSON.stringify([new Date()], function (key, value) {
                return this[key] instanceof Date ?
                    'Date(' + this[key] + ')' : value;
            });
            // text is '["Date(---current time---)"]'


        JSON.parse(text, reviver)
            This method parses a JSON text to produce an object or array.
            It can throw a SyntaxError exception.

            The optional reviver parameter is a function that can filter and
            transform the results. It receives each of the keys and values,
            and its return value is used instead of the original value.
            If it returns what it received, then the structure is not modified.
            If it returns undefined then the member is deleted.

            Example:

            // Parse the text. Values that look like ISO date strings will
            // be converted to Date objects.

            myData = JSON.parse(text, function (key, value) {
                var a;
                if (typeof value === 'string') {
                    a =
/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)Z$/.exec(value);
                    if (a) {
                        return new Date(Date.UTC(+a[1], +a[2] - 1, +a[3], +a[4],
                            +a[5], +a[6]));
                    }
                }
                return value;
            });

            myData = JSON.parse('["Date(09/09/2001)"]', function (key, value) {
                var d;
                if (typeof value === 'string' &&
                        value.slice(0, 5) === 'Date(' &&
                        value.slice(-1) === ')') {
                    d = new Date(value.slice(5, -1));
                    if (d) {
                        return d;
                    }
                }
                return value;
            });


    This is a reference implementation. You are free to copy, modify, or
    redistribute.
*/

/*jslint evil: true, regexp: true */

/*members "", "\b", "\t", "\n", "\f", "\r", "\"", JSON, "\\", apply,
    call, charCodeAt, getUTCDate, getUTCFullYear, getUTCHours,
    getUTCMinutes, getUTCMonth, getUTCSeconds, hasOwnProperty, join,
    lastIndex, length, parse, prototype, push, replace, slice, stringify,
    test, toJSON, toString, valueOf
*/


// Create a JSON object only if one does not already exist. We create the
// methods in a closure to avoid creating global variables.

var JSON = {};

(function () {
    'use strict';

    function f(n) {
        // Format integers to have at least two digits.
        return n < 10 ? '0' + n : n;
    }

    if (typeof Date.prototype.toJSON !== 'function') {

        Date.prototype.toJSON = function (key) {

            return isFinite(this.valueOf())
                ? this.getUTCFullYear()     + '-' +
                    f(this.getUTCMonth() + 1) + '-' +
                    f(this.getUTCDate())      + 'T' +
                    f(this.getUTCHours())     + ':' +
                    f(this.getUTCMinutes())   + ':' +
                    f(this.getUTCSeconds())   + 'Z'
                : null;
        };

        String.prototype.toJSON      =
            Number.prototype.toJSON  =
            Boolean.prototype.toJSON = function (key) {
                return this.valueOf();
            };
    }

    var cx = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,
        gap,
        indent,
        meta = {    // table of character substitutions
            '\b': '\\b',
            '\t': '\\t',
            '\n': '\\n',
            '\f': '\\f',
            '\r': '\\r',
            '"' : '\\"',
            '\\': '\\\\'
        },
        rep;


    function quote(string) {

// If the string contains no control characters, no quote characters, and no
// backslash characters, then we can safely slap some quotes around it.
// Otherwise we must also replace the offending characters with safe escape
// sequences.

        escapable.lastIndex = 0;
        return escapable.test(string) ? '"' + string.replace(escapable, function (a) {
            var c = meta[a];
            return typeof c === 'string'
                ? c
                : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
        }) + '"' : '"' + string + '"';
    }


    function str(key, holder) {

// Produce a string from holder[key].

        var i,          // The loop counter.
            k,          // The member key.
            v,          // The member value.
            length,
            mind = gap,
            partial,
            value = holder[key];

// If the value has a toJSON method, call it to obtain a replacement value.

        if (value && typeof value === 'object' &&
                typeof value.toJSON === 'function') {
            value = value.toJSON(key);
        }

// If we were called with a replacer function, then call the replacer to
// obtain a replacement value.

        if (typeof rep === 'function') {
            value = rep.call(holder, key, value);
        }

// What happens next depends on the value's type.

        switch (typeof value) {
        case 'string':
            return quote(value);

        case 'number':

// JSON numbers must be finite. Encode non-finite numbers as null.

            return isFinite(value) ? String(value) : 'null';

        case 'boolean':
        case 'null':

// If the value is a boolean or null, convert it to a string. Note:
// typeof null does not produce 'null'. The case is included here in
// the remote chance that this gets fixed someday.

            return String(value);

// If the type is 'object', we might be dealing with an object or an array or
// null.

        case 'object':

// Due to a specification blunder in ECMAScript, typeof null is 'object',
// so watch out for that case.

            if (!value) {
                return 'null';
            }

// Make an array to hold the partial results of stringifying this object value.

            gap += indent;
            partial = [];

// Is the value an array?

            if (Object.prototype.toString.apply(value) === '[object Array]') {

// The value is an array. Stringify every element. Use null as a placeholder
// for non-JSON values.

                length = value.length;
                for (i = 0; i < length; i += 1) {
                    partial[i] = str(i, value) || 'null';
                }

// Join all of the elements together, separated with commas, and wrap them in
// brackets.

                v = partial.length === 0
                    ? '[]'
                    : gap
                    ? '[\n' + gap + partial.join(',\n' + gap) + '\n' + mind + ']'
                    : '[' + partial.join(',') + ']';
                gap = mind;
                return v;
            }

// If the replacer is an array, use it to select the members to be stringified.

            if (rep && typeof rep === 'object') {
                length = rep.length;
                for (i = 0; i < length; i += 1) {
                    if (typeof rep[i] === 'string') {
                        k = rep[i];
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            } else {

// Otherwise, iterate through all of the keys in the object.

                for (k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            }

// Join all of the member texts together, separated with commas,
// and wrap them in braces.

            v = partial.length === 0
                ? '{}'
                : gap
                ? '{\n' + gap + partial.join(',\n' + gap) + '\n' + mind + '}'
                : '{' + partial.join(',') + '}';
            gap = mind;
            return v;
        }
    }

// If the JSON object does not yet have a stringify method, give it one.

    if (typeof JSON.stringify !== 'function') {
        JSON.stringify = function (value, replacer, space) {

// The stringify method takes a value and an optional replacer, and an optional
// space parameter, and returns a JSON text. The replacer can be a function
// that can replace values, or an array of strings that will select the keys.
// A default replacer method can be provided. Use of the space parameter can
// produce text that is more easily readable.

            var i;
            gap = '';
            indent = '';

// If the space parameter is a number, make an indent string containing that
// many spaces.

            if (typeof space === 'number') {
                for (i = 0; i < space; i += 1) {
                    indent += ' ';
                }

// If the space parameter is a string, it will be used as the indent string.

            } else if (typeof space === 'string') {
                indent = space;
            }

// If there is a replacer, it must be a function or an array.
// Otherwise, throw an error.

            rep = replacer;
            if (replacer && typeof replacer !== 'function' &&
                    (typeof replacer !== 'object' ||
                    typeof replacer.length !== 'number')) {
                throw new Error('JSON.stringify');
            }

// Make a fake root object containing our value under the key of ''.
// Return the result of stringifying the value.

            return str('', {'': value});
        };
    }


// If the JSON object does not yet have a parse method, give it one.

    if (typeof JSON.parse !== 'function') {
        JSON.parse = function (text, reviver) {

// The parse method takes a text and an optional reviver function, and returns
// a JavaScript value if the text is a valid JSON text.

            var j;

            function walk(holder, key) {

// The walk method is used to recursively walk the resulting structure so
// that modifications can be made.

                var k, v, value = holder[key];
                if (value && typeof value === 'object') {
                    for (k in value) {
                        if (Object.prototype.hasOwnProperty.call(value, k)) {
                            v = walk(value, k);
                            if (v !== undefined) {
                                value[k] = v;
                            } else {
                                delete value[k];
                            }
                        }
                    }
                }
                return reviver.call(holder, key, value);
            }


// Parsing happens in four stages. In the first stage, we replace certain
// Unicode characters with escape sequences. JavaScript handles many characters
// incorrectly, either silently deleting them, or treating them as line endings.

            text = String(text);
            cx.lastIndex = 0;
            if (cx.test(text)) {
                text = text.replace(cx, function (a) {
                    return '\\u' +
                        ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
                });
            }

// In the second stage, we run the text against regular expressions that look
// for non-JSON patterns. We are especially concerned with '()' and 'new'
// because they can cause invocation, and '=' because it can cause mutation.
// But just to be safe, we want to reject all unexpected forms.

// We split the second stage into 4 regexp operations in order to work around
// crippling inefficiencies in IE's and Safari's regexp engines. First we
// replace the JSON backslash pairs with '@' (a non-JSON character). Second, we
// replace all simple value tokens with ']' characters. Third, we delete all
// open brackets that follow a colon or comma or that begin the text. Finally,
// we look to see that the remaining characters are only whitespace or ']' or
// ',' or ':' or '{' or '}'. If that is so, then the text is safe for eval.

            if (/^[\],:{}\s]*$/
                    .test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
                        .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
                        .replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {

// In the third stage we use the eval function to compile the text into a
// JavaScript structure. The '{' operator is subject to a syntactic ambiguity
// in JavaScript: it can begin a block or an object literal. We wrap the text
// in parens to eliminate the ambiguity.

                j = eval('(' + text + ')');

// In the optional fourth stage, we recursively walk the new structure, passing
// each name/value pair to a reviver function for possible transformation.

                return typeof reviver === 'function'
                    ? walk({'': j}, '')
                    : j;
            }

// If the text is not JSON parseable, then a SyntaxError is thrown.

            throw new SyntaxError('JSON.parse');
        };
    }
}());

module.exports = JSON
},{}],15:[function(require,module,exports){
/**
 * Module dependencies
 */

var debug = require('debug')('jsonp');

/**
 * Module exports.
 */

module.exports = jsonp;

/**
 * Callback index.
 */

var count = 0;

/**
 * Noop function.
 */

function noop(){}

/**
 * JSONP handler
 *
 * Options:
 *  - param {String} qs parameter (`callback`)
 *  - timeout {Number} how long after a timeout error is emitted (`60000`)
 *
 * @param {String} url
 * @param {Object|Function} optional options / callback
 * @param {Function} optional callback
 */

function jsonp(url, opts, fn){
  if ('function' == typeof opts) {
    fn = opts;
    opts = {};
  }
  if (!opts) opts = {};

  var prefix = opts.prefix || '__jp';
  var param = opts.param || 'callback';
  var timeout = null != opts.timeout ? opts.timeout : 60000;
  var enc = encodeURIComponent;
  var target = document.getElementsByTagName('script')[0] || document.head;
  var script;
  var timer;

  // generate a unique id for this request
  var id = prefix + (count++);

  if (timeout) {
    timer = setTimeout(function(){
      cleanup();
      if (fn) fn(new Error('Timeout'));
    }, timeout);
  }

  function cleanup(){
    script.parentNode.removeChild(script);
    window[id] = noop;
  }

  window[id] = function(data){
    debug('jsonp got', data);
    if (timer) clearTimeout(timer);
    cleanup();
    if (fn) fn(null, data);
  };

  // add qs component
  url += (~url.indexOf('?') ? '&' : '?') + param + '=' + enc(id);
  url = url.replace('?&', '?');

  debug('jsonp req "%s"', url);

  // create script
  script = document.createElement('script');
  script.src = url;
  target.parentNode.insertBefore(script, target);
}

},{"debug":11}],16:[function(require,module,exports){
/**
 * Object#toString() ref for stringify().
 */

var toString = Object.prototype.toString;

/**
 * Object#hasOwnProperty ref
 */

var hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Array#indexOf shim.
 */

var indexOf = typeof Array.prototype.indexOf === 'function'
  ? function(arr, el) { return arr.indexOf(el); }
  : function(arr, el) {
      if (typeof arr == 'string' && typeof "a"[0] == 'undefined') {
        arr = arr.split('');
      }
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] === el) return i;
      }
      return -1;
    };

/**
 * Array.isArray shim.
 */

var isArray = Array.isArray || function(arr) {
  return toString.call(arr) == '[object Array]';
};

/**
 * Object.keys shim.
 */

var objectKeys = Object.keys || function(obj) {
  var ret = [];
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      ret.push(key);
    }
  }
  return ret;
};

/**
 * Array#forEach shim.
 */

var forEach = typeof Array.prototype.forEach === 'function'
  ? function(arr, fn) { return arr.forEach(fn); }
  : function(arr, fn) {
      for (var i = 0; i < arr.length; i++) fn(arr[i]);
    };

/**
 * Array#reduce shim.
 */

var reduce = function(arr, fn, initial) {
  if (typeof arr.reduce === 'function') return arr.reduce(fn, initial);
  var res = initial;
  for (var i = 0; i < arr.length; i++) res = fn(res, arr[i]);
  return res;
};

/**
 * Cache non-integer test regexp.
 */

var isint = /^[0-9]+$/;

function promote(parent, key) {
  if (parent[key].length == 0) return parent[key] = {}
  var t = {};
  for (var i in parent[key]) {
    if (hasOwnProperty.call(parent[key], i)) {
      t[i] = parent[key][i];
    }
  }
  parent[key] = t;
  return t;
}

function parse(parts, parent, key, val) {
  var part = parts.shift();

  // illegal
  if (hasOwnProperty.call(Object.prototype, key)) return;

  // end
  if (!part) {
    if (isArray(parent[key])) {
      parent[key].push(val);
    } else if ('object' == typeof parent[key]) {
      parent[key] = val;
    } else if ('undefined' == typeof parent[key]) {
      parent[key] = val;
    } else {
      parent[key] = [parent[key], val];
    }
    // array
  } else {
    var obj = parent[key] = parent[key] || [];
    if (']' == part) {
      if (isArray(obj)) {
        if ('' != val) obj.push(val);
      } else if ('object' == typeof obj) {
        obj[objectKeys(obj).length] = val;
      } else {
        obj = parent[key] = [parent[key], val];
      }
      // prop
    } else if (~indexOf(part, ']')) {
      part = part.substr(0, part.length - 1);
      if (!isint.test(part) && isArray(obj)) obj = promote(parent, key);
      parse(parts, obj, part, val);
      // key
    } else {
      if (!isint.test(part) && isArray(obj)) obj = promote(parent, key);
      parse(parts, obj, part, val);
    }
  }
}

/**
 * Merge parent key/val pair.
 */

function merge(parent, key, val){
  if (~indexOf(key, ']')) {
    var parts = key.split('[')
      , len = parts.length
      , last = len - 1;
    parse(parts, parent, 'base', val);
    // optimize
  } else {
    if (!isint.test(key) && isArray(parent.base)) {
      var t = {};
      for (var k in parent.base) t[k] = parent.base[k];
      parent.base = t;
    }
    set(parent.base, key, val);
  }

  return parent;
}

/**
 * Compact sparse arrays.
 */

function compact(obj) {
  if ('object' != typeof obj) return obj;

  if (isArray(obj)) {
    var ret = [];

    for (var i in obj) {
      if (hasOwnProperty.call(obj, i)) {
        ret.push(obj[i]);
      }
    }

    return ret;
  }

  for (var key in obj) {
    obj[key] = compact(obj[key]);
  }

  return obj;
}

/**
 * Parse the given obj.
 */

function parseObject(obj){
  var ret = { base: {} };

  forEach(objectKeys(obj), function(name){
    merge(ret, name, obj[name]);
  });

  return compact(ret.base);
}

/**
 * Parse the given str.
 */

function parseString(str, options){
  var ret = reduce(String(str).split(options.separator), function(ret, pair){
    var eql = indexOf(pair, '=')
      , brace = lastBraceInKey(pair)
      , key = pair.substr(0, brace || eql)
      , val = pair.substr(brace || eql, pair.length)
      , val = val.substr(indexOf(val, '=') + 1, val.length);

    // ?foo
    if ('' == key) key = pair, val = '';
    if ('' == key) return ret;

    return merge(ret, decode(key), decode(val));
  }, { base: {} }).base;

  return compact(ret);
}

/**
 * Parse the given query `str` or `obj`, returning an object.
 *
 * @param {String} str | {Object} obj
 * @return {Object}
 * @api public
 */

exports.parse = function(str, options){
  if (null == str || '' == str) return {};
  options = options || {};
  options.separator = options.separator || '&';
  return 'object' == typeof str
    ? parseObject(str)
    : parseString(str, options);
};

/**
 * Turn the given `obj` into a query string
 *
 * @param {Object} obj
 * @return {String}
 * @api public
 */

var stringify = exports.stringify = function(obj, prefix) {
  if (isArray(obj)) {
    return stringifyArray(obj, prefix);
  } else if ('[object Object]' == toString.call(obj)) {
    return stringifyObject(obj, prefix);
  } else if ('string' == typeof obj) {
    return stringifyString(obj, prefix);
  } else {
    return prefix + '=' + encodeURIComponent(String(obj));
  }
};

/**
 * Stringify the given `str`.
 *
 * @param {String} str
 * @param {String} prefix
 * @return {String}
 * @api private
 */

function stringifyString(str, prefix) {
  if (!prefix) throw new TypeError('stringify expects an object');
  return prefix + '=' + encodeURIComponent(str);
}

/**
 * Stringify the given `arr`.
 *
 * @param {Array} arr
 * @param {String} prefix
 * @return {String}
 * @api private
 */

function stringifyArray(arr, prefix) {
  var ret = [];
  if (!prefix) throw new TypeError('stringify expects an object');
  for (var i = 0; i < arr.length; i++) {
    ret.push(stringify(arr[i], prefix + '[' + i + ']'));
  }
  return ret.join('&');
}

/**
 * Stringify the given `obj`.
 *
 * @param {Object} obj
 * @param {String} prefix
 * @return {String}
 * @api private
 */

function stringifyObject(obj, prefix) {
  var ret = []
    , keys = objectKeys(obj)
    , key;

  for (var i = 0, len = keys.length; i < len; ++i) {
    key = keys[i];
    if ('' == key) continue;
    if (null == obj[key]) {
      ret.push(encodeURIComponent(key) + '=');
    } else {
      ret.push(stringify(obj[key], prefix
        ? prefix + '[' + encodeURIComponent(key) + ']'
        : encodeURIComponent(key)));
    }
  }

  return ret.join('&');
}

/**
 * Set `obj`'s `key` to `val` respecting
 * the weird and wonderful syntax of a qs,
 * where "foo=bar&foo=baz" becomes an array.
 *
 * @param {Object} obj
 * @param {String} key
 * @param {String} val
 * @api private
 */

function set(obj, key, val) {
  var v = obj[key];
  if (hasOwnProperty.call(Object.prototype, key)) return;
  if (undefined === v) {
    obj[key] = val;
  } else if (isArray(v)) {
    v.push(val);
  } else {
    obj[key] = [v, val];
  }
}

/**
 * Locate last brace in `str` within the key.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function lastBraceInKey(str) {
  var len = str.length
    , brace
    , c;
  for (var i = 0; i < len; ++i) {
    c = str[i];
    if (']' == c) brace = false;
    if ('[' == c) brace = true;
    if ('=' == c && !brace) return i;
  }
}

/**
 * Decode `str`.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function decode(str) {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' '));
  } catch (err) {
    return str;
  }
}

},{}],17:[function(require,module,exports){
/*!
  * Reqwest! A general purpose XHR connection manager
  * license MIT (c) Dustin Diaz 2014
  * https://github.com/ded/reqwest
  */

!function (name, context, definition) {
  if (typeof module != 'undefined' && module.exports) module.exports = definition()
  else if (typeof define == 'function' && define.amd) define(definition)
  else context[name] = definition()
}('reqwest', this, function () {

  var win = window
    , doc = document
    , httpsRe = /^http/
    , protocolRe = /(^\w+):\/\//
    , twoHundo = /^(20\d|1223)$/ //http://stackoverflow.com/questions/10046972/msie-returns-status-code-of-1223-for-ajax-request
    , byTag = 'getElementsByTagName'
    , readyState = 'readyState'
    , contentType = 'Content-Type'
    , requestedWith = 'X-Requested-With'
    , head = doc[byTag]('head')[0]
    , uniqid = 0
    , callbackPrefix = 'reqwest_' + (+new Date())
    , lastValue // data stored by the most recent JSONP callback
    , xmlHttpRequest = 'XMLHttpRequest'
    , xDomainRequest = 'XDomainRequest'
    , noop = function () {}

    , isArray = typeof Array.isArray == 'function'
        ? Array.isArray
        : function (a) {
            return a instanceof Array
          }

    , defaultHeaders = {
          'contentType': 'application/x-www-form-urlencoded'
        , 'requestedWith': xmlHttpRequest
        , 'accept': {
              '*':  'text/javascript, text/html, application/xml, text/xml, */*'
            , 'xml':  'application/xml, text/xml'
            , 'html': 'text/html'
            , 'text': 'text/plain'
            , 'json': 'application/json, text/javascript'
            , 'js':   'application/javascript, text/javascript'
          }
      }

    , xhr = function(o) {
        // is it x-domain
        if (o['crossOrigin'] === true) {
          var xhr = win[xmlHttpRequest] ? new XMLHttpRequest() : null
          if (xhr && 'withCredentials' in xhr) {
            return xhr
          } else if (win[xDomainRequest]) {
            return new XDomainRequest()
          } else {
            throw new Error('Browser does not support cross-origin requests')
          }
        } else if (win[xmlHttpRequest]) {
          return new XMLHttpRequest()
        } else {
          return new ActiveXObject('Microsoft.XMLHTTP')
        }
      }
    , globalSetupOptions = {
        dataFilter: function (data) {
          return data
        }
      }

  function succeed(r) {
    var protocol = protocolRe.exec(r.url);
    protocol = (protocol && protocol[1]) || window.location.protocol;
    return httpsRe.test(protocol) ? twoHundo.test(r.request.status) : !!r.request.response;
  }

  function handleReadyState(r, success, error) {
    return function () {
      // use _aborted to mitigate against IE err c00c023f
      // (can't read props on aborted request objects)
      if (r._aborted) return error(r.request)
      if (r._timedOut) return error(r.request, 'Request is aborted: timeout')
      if (r.request && r.request[readyState] == 4) {
        r.request.onreadystatechange = noop
        if (succeed(r)) success(r.request)
        else
          error(r.request)
      }
    }
  }

  function setHeaders(http, o) {
    var headers = o['headers'] || {}
      , h

    headers['Accept'] = headers['Accept']
      || defaultHeaders['accept'][o['type']]
      || defaultHeaders['accept']['*']

    var isAFormData = typeof FormData === 'function' && (o['data'] instanceof FormData);
    // breaks cross-origin requests with legacy browsers
    if (!o['crossOrigin'] && !headers[requestedWith]) headers[requestedWith] = defaultHeaders['requestedWith']
    if (!headers[contentType] && !isAFormData) headers[contentType] = o['contentType'] || defaultHeaders['contentType']
    for (h in headers)
      headers.hasOwnProperty(h) && 'setRequestHeader' in http && http.setRequestHeader(h, headers[h])
  }

  function setCredentials(http, o) {
    if (typeof o['withCredentials'] !== 'undefined' && typeof http.withCredentials !== 'undefined') {
      http.withCredentials = !!o['withCredentials']
    }
  }

  function generalCallback(data) {
    lastValue = data
  }

  function urlappend (url, s) {
    return url + (/\?/.test(url) ? '&' : '?') + s
  }

  function handleJsonp(o, fn, err, url) {
    var reqId = uniqid++
      , cbkey = o['jsonpCallback'] || 'callback' // the 'callback' key
      , cbval = o['jsonpCallbackName'] || reqwest.getcallbackPrefix(reqId)
      , cbreg = new RegExp('((^|\\?|&)' + cbkey + ')=([^&]+)')
      , match = url.match(cbreg)
      , script = doc.createElement('script')
      , loaded = 0
      , isIE10 = navigator.userAgent.indexOf('MSIE 10.0') !== -1

    if (match) {
      if (match[3] === '?') {
        url = url.replace(cbreg, '$1=' + cbval) // wildcard callback func name
      } else {
        cbval = match[3] // provided callback func name
      }
    } else {
      url = urlappend(url, cbkey + '=' + cbval) // no callback details, add 'em
    }

    win[cbval] = generalCallback

    script.type = 'text/javascript'
    script.src = url
    script.async = true
    if (typeof script.onreadystatechange !== 'undefined' && !isIE10) {
      // need this for IE due to out-of-order onreadystatechange(), binding script
      // execution to an event listener gives us control over when the script
      // is executed. See http://jaubourg.net/2010/07/loading-script-as-onclick-handler-of.html
      script.htmlFor = script.id = '_reqwest_' + reqId
    }

    script.onload = script.onreadystatechange = function () {
      if ((script[readyState] && script[readyState] !== 'complete' && script[readyState] !== 'loaded') || loaded) {
        return false
      }
      script.onload = script.onreadystatechange = null
      script.onclick && script.onclick()
      // Call the user callback with the last value stored and clean up values and scripts.
      fn(lastValue)
      lastValue = undefined
      head.removeChild(script)
      loaded = 1
    }

    // Add the script to the DOM head
    head.appendChild(script)

    // Enable JSONP timeout
    return {
      abort: function () {
        script.onload = script.onreadystatechange = null
        err({}, 'Request is aborted: timeout', {})
        lastValue = undefined
        head.removeChild(script)
        loaded = 1
      }
    }
  }

  function getRequest(fn, err) {
    var o = this.o
      , method = (o['method'] || 'GET').toUpperCase()
      , url = typeof o === 'string' ? o : o['url']
      // convert non-string objects to query-string form unless o['processData'] is false
      , data = (o['processData'] !== false && o['data'] && typeof o['data'] !== 'string')
        ? reqwest.toQueryString(o['data'])
        : (o['data'] || null)
      , http
      , sendWait = false

    // if we're working on a GET request and we have data then we should append
    // query string to end of URL and not post data
    if ((o['type'] == 'jsonp' || method == 'GET') && data) {
      url = urlappend(url, data)
      data = null
    }

    if (o['type'] == 'jsonp') return handleJsonp(o, fn, err, url)

    // get the xhr from the factory if passed
    // if the factory returns null, fall-back to ours
    http = (o.xhr && o.xhr(o)) || xhr(o)

    http.open(method, url, o['async'] === false ? false : true)
    setHeaders(http, o)
    setCredentials(http, o)
    if (win[xDomainRequest] && http instanceof win[xDomainRequest]) {
        http.onload = fn
        http.onerror = err
        // NOTE: see
        // http://social.msdn.microsoft.com/Forums/en-US/iewebdevelopment/thread/30ef3add-767c-4436-b8a9-f1ca19b4812e
        http.onprogress = function() {}
        sendWait = true
    } else {
      http.onreadystatechange = handleReadyState(this, fn, err)
    }
    o['before'] && o['before'](http)
    if (sendWait) {
      setTimeout(function () {
        http.send(data)
      }, 200)
    } else {
      http.send(data)
    }
    return http
  }

  function Reqwest(o, fn) {
    this.o = o
    this.fn = fn

    init.apply(this, arguments)
  }

  function setType(header) {
    // json, javascript, text/plain, text/html, xml
    if (header.match('json')) return 'json'
    if (header.match('javascript')) return 'js'
    if (header.match('text')) return 'html'
    if (header.match('xml')) return 'xml'
  }

  function init(o, fn) {

    this.url = typeof o == 'string' ? o : o['url']
    this.timeout = null

    // whether request has been fulfilled for purpose
    // of tracking the Promises
    this._fulfilled = false
    // success handlers
    this._successHandler = function(){}
    this._fulfillmentHandlers = []
    // error handlers
    this._errorHandlers = []
    // complete (both success and fail) handlers
    this._completeHandlers = []
    this._erred = false
    this._responseArgs = {}

    var self = this

    fn = fn || function () {}

    if (o['timeout']) {
      this.timeout = setTimeout(function () {
        timedOut()
      }, o['timeout'])
    }

    if (o['success']) {
      this._successHandler = function () {
        o['success'].apply(o, arguments)
      }
    }

    if (o['error']) {
      this._errorHandlers.push(function () {
        o['error'].apply(o, arguments)
      })
    }

    if (o['complete']) {
      this._completeHandlers.push(function () {
        o['complete'].apply(o, arguments)
      })
    }

    function complete (resp) {
      o['timeout'] && clearTimeout(self.timeout)
      self.timeout = null
      while (self._completeHandlers.length > 0) {
        self._completeHandlers.shift()(resp)
      }
    }

    function success (resp) {
      var type = o['type'] || resp && setType(resp.getResponseHeader('Content-Type')) // resp can be undefined in IE
      resp = (type !== 'jsonp') ? self.request : resp
      // use global data filter on response text
      var filteredResponse = globalSetupOptions.dataFilter(resp.responseText, type)
        , r = filteredResponse
      try {
        resp.responseText = r
      } catch (e) {
        // can't assign this in IE<=8, just ignore
      }
      if (r) {
        switch (type) {
        case 'json':
          try {
            resp = win.JSON ? win.JSON.parse(r) : eval('(' + r + ')')
          } catch (err) {
            return error(resp, 'Could not parse JSON in response', err)
          }
          break
        case 'js':
          resp = eval(r)
          break
        case 'html':
          resp = r
          break
        case 'xml':
          resp = resp.responseXML
              && resp.responseXML.parseError // IE trololo
              && resp.responseXML.parseError.errorCode
              && resp.responseXML.parseError.reason
            ? null
            : resp.responseXML
          break
        }
      }

      self._responseArgs.resp = resp
      self._fulfilled = true
      fn(resp)
      self._successHandler(resp)
      while (self._fulfillmentHandlers.length > 0) {
        resp = self._fulfillmentHandlers.shift()(resp)
      }

      complete(resp)
    }

    function timedOut() {
      self._timedOut = true
      self.request.abort()      
    }

    function error(resp, msg, t) {
      resp = self.request
      self._responseArgs.resp = resp
      self._responseArgs.msg = msg
      self._responseArgs.t = t
      self._erred = true
      while (self._errorHandlers.length > 0) {
        self._errorHandlers.shift()(resp, msg, t)
      }
      complete(resp)
    }

    this.request = getRequest.call(this, success, error)
  }

  Reqwest.prototype = {
    abort: function () {
      this._aborted = true
      this.request.abort()
    }

  , retry: function () {
      init.call(this, this.o, this.fn)
    }

    /**
     * Small deviation from the Promises A CommonJs specification
     * http://wiki.commonjs.org/wiki/Promises/A
     */

    /**
     * `then` will execute upon successful requests
     */
  , then: function (success, fail) {
      success = success || function () {}
      fail = fail || function () {}
      if (this._fulfilled) {
        this._responseArgs.resp = success(this._responseArgs.resp)
      } else if (this._erred) {
        fail(this._responseArgs.resp, this._responseArgs.msg, this._responseArgs.t)
      } else {
        this._fulfillmentHandlers.push(success)
        this._errorHandlers.push(fail)
      }
      return this
    }

    /**
     * `always` will execute whether the request succeeds or fails
     */
  , always: function (fn) {
      if (this._fulfilled || this._erred) {
        fn(this._responseArgs.resp)
      } else {
        this._completeHandlers.push(fn)
      }
      return this
    }

    /**
     * `fail` will execute when the request fails
     */
  , fail: function (fn) {
      if (this._erred) {
        fn(this._responseArgs.resp, this._responseArgs.msg, this._responseArgs.t)
      } else {
        this._errorHandlers.push(fn)
      }
      return this
    }
  , 'catch': function (fn) {
      return this.fail(fn)
    }
  }

  function reqwest(o, fn) {
    return new Reqwest(o, fn)
  }

  // normalize newline variants according to spec -> CRLF
  function normalize(s) {
    return s ? s.replace(/\r?\n/g, '\r\n') : ''
  }

  function serial(el, cb) {
    var n = el.name
      , t = el.tagName.toLowerCase()
      , optCb = function (o) {
          // IE gives value="" even where there is no value attribute
          // 'specified' ref: http://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-862529273
          if (o && !o['disabled'])
            cb(n, normalize(o['attributes']['value'] && o['attributes']['value']['specified'] ? o['value'] : o['text']))
        }
      , ch, ra, val, i

    // don't serialize elements that are disabled or without a name
    if (el.disabled || !n) return

    switch (t) {
    case 'input':
      if (!/reset|button|image|file/i.test(el.type)) {
        ch = /checkbox/i.test(el.type)
        ra = /radio/i.test(el.type)
        val = el.value
        // WebKit gives us "" instead of "on" if a checkbox has no value, so correct it here
        ;(!(ch || ra) || el.checked) && cb(n, normalize(ch && val === '' ? 'on' : val))
      }
      break
    case 'textarea':
      cb(n, normalize(el.value))
      break
    case 'select':
      if (el.type.toLowerCase() === 'select-one') {
        optCb(el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null)
      } else {
        for (i = 0; el.length && i < el.length; i++) {
          el.options[i].selected && optCb(el.options[i])
        }
      }
      break
    }
  }

  // collect up all form elements found from the passed argument elements all
  // the way down to child elements; pass a '<form>' or form fields.
  // called with 'this'=callback to use for serial() on each element
  function eachFormElement() {
    var cb = this
      , e, i
      , serializeSubtags = function (e, tags) {
          var i, j, fa
          for (i = 0; i < tags.length; i++) {
            fa = e[byTag](tags[i])
            for (j = 0; j < fa.length; j++) serial(fa[j], cb)
          }
        }

    for (i = 0; i < arguments.length; i++) {
      e = arguments[i]
      if (/input|select|textarea/i.test(e.tagName)) serial(e, cb)
      serializeSubtags(e, [ 'input', 'select', 'textarea' ])
    }
  }

  // standard query string style serialization
  function serializeQueryString() {
    return reqwest.toQueryString(reqwest.serializeArray.apply(null, arguments))
  }

  // { 'name': 'value', ... } style serialization
  function serializeHash() {
    var hash = {}
    eachFormElement.apply(function (name, value) {
      if (name in hash) {
        hash[name] && !isArray(hash[name]) && (hash[name] = [hash[name]])
        hash[name].push(value)
      } else hash[name] = value
    }, arguments)
    return hash
  }

  // [ { name: 'name', value: 'value' }, ... ] style serialization
  reqwest.serializeArray = function () {
    var arr = []
    eachFormElement.apply(function (name, value) {
      arr.push({name: name, value: value})
    }, arguments)
    return arr
  }

  reqwest.serialize = function () {
    if (arguments.length === 0) return ''
    var opt, fn
      , args = Array.prototype.slice.call(arguments, 0)

    opt = args.pop()
    opt && opt.nodeType && args.push(opt) && (opt = null)
    opt && (opt = opt.type)

    if (opt == 'map') fn = serializeHash
    else if (opt == 'array') fn = reqwest.serializeArray
    else fn = serializeQueryString

    return fn.apply(null, args)
  }

  reqwest.toQueryString = function (o, trad) {
    var prefix, i
      , traditional = trad || false
      , s = []
      , enc = encodeURIComponent
      , add = function (key, value) {
          // If value is a function, invoke it and return its value
          value = ('function' === typeof value) ? value() : (value == null ? '' : value)
          s[s.length] = enc(key) + '=' + enc(value)
        }
    // If an array was passed in, assume that it is an array of form elements.
    if (isArray(o)) {
      for (i = 0; o && i < o.length; i++) add(o[i]['name'], o[i]['value'])
    } else {
      // If traditional, encode the "old" way (the way 1.3.2 or older
      // did it), otherwise encode params recursively.
      for (prefix in o) {
        if (o.hasOwnProperty(prefix)) buildParams(prefix, o[prefix], traditional, add)
      }
    }

    // spaces should be + according to spec
    return s.join('&').replace(/%20/g, '+')
  }

  function buildParams(prefix, obj, traditional, add) {
    var name, i, v
      , rbracket = /\[\]$/

    if (isArray(obj)) {
      // Serialize array item.
      for (i = 0; obj && i < obj.length; i++) {
        v = obj[i]
        if (traditional || rbracket.test(prefix)) {
          // Treat each array item as a scalar.
          add(prefix, v)
        } else {
          buildParams(prefix + '[' + (typeof v === 'object' ? i : '') + ']', v, traditional, add)
        }
      }
    } else if (obj && obj.toString() === '[object Object]') {
      // Serialize object item.
      for (name in obj) {
        buildParams(prefix + '[' + name + ']', obj[name], traditional, add)
      }

    } else {
      // Serialize scalar item.
      add(prefix, obj)
    }
  }

  reqwest.getcallbackPrefix = function () {
    return callbackPrefix
  }

  // jQuery and Zepto compatibility, differences can be remapped here so you can call
  // .ajax.compat(options, callback)
  reqwest.compat = function (o, fn) {
    if (o) {
      o['type'] && (o['method'] = o['type']) && delete o['type']
      o['dataType'] && (o['type'] = o['dataType'])
      o['jsonpCallback'] && (o['jsonpCallbackName'] = o['jsonpCallback']) && delete o['jsonpCallback']
      o['jsonp'] && (o['jsonpCallback'] = o['jsonp'])
    }
    return new Reqwest(o, fn)
  }

  reqwest.ajaxSetup = function (options) {
    options = options || {}
    for (var k in options) {
      globalSetupOptions[k] = options[k]
    }
  }

  return reqwest
});

},{}],18:[function(require,module,exports){

exports = module.exports = trim;

function trim(str){
  return str.replace(/^\s*|\s*$/g, '');
}

exports.left = function(str){
  return str.replace(/^\s*/, '');
};

exports.right = function(str){
  return str.replace(/\s*$/, '');
};

},{}],19:[function(require,module,exports){
var WinChan = (function() {
  var RELAY_FRAME_NAME = "__winchan_relay_frame";
  var CLOSE_CMD = "die";

  // a portable addListener implementation
  function addListener(w, event, cb) {
    if(w.attachEvent) w.attachEvent('on' + event, cb);
    else if (w.addEventListener) w.addEventListener(event, cb, false);
  }

  // a portable removeListener implementation
  function removeListener(w, event, cb) {
    if(w.detachEvent) w.detachEvent('on' + event, cb);
    else if (w.removeEventListener) w.removeEventListener(event, cb, false);
  }


  // checking for IE8 or above
  function isInternetExplorer() {
    var rv = -1; // Return value assumes failure.
    var ua = navigator.userAgent;
    if (navigator.appName === 'Microsoft Internet Explorer') {
      var re = new RegExp("MSIE ([0-9]{1,}[\.0-9]{0,})");
      if (re.exec(ua) != null)
        rv = parseFloat(RegExp.$1);
    }
    // IE > 11
    else if (ua.indexOf("Trident") > -1) {
      var re = new RegExp("rv:([0-9]{2,2}[\.0-9]{0,})");
      if (re.exec(ua) !== null) {
        rv = parseFloat(RegExp.$1);
      }
    }

    return rv >= 8;
  }

  // checking Mobile Firefox (Fennec)
  function isFennec() {
    try {
      // We must check for both XUL and Java versions of Fennec.  Both have
      // distinct UA strings.
      var userAgent = navigator.userAgent;
      return (userAgent.indexOf('Fennec/') != -1) ||  // XUL
             (userAgent.indexOf('Firefox/') != -1 && userAgent.indexOf('Android') != -1);   // Java
    } catch(e) {}
    return false;
  }

  // feature checking to see if this platform is supported at all
  function isSupported() {
    return (window.JSON && window.JSON.stringify &&
            window.JSON.parse && window.postMessage);
  }

  // given a URL, extract the origin. Taken from: https://github.com/firebase/firebase-simple-login/blob/d2cb95b9f812d8488bdbfba51c3a7c153ba1a074/js/src/simple-login/transports/WinChan.js#L25-L30
  function extractOrigin(url) {
    if (!/^https?:\/\//.test(url)) url = window.location.href;
    var m = /^(https?:\/\/[\-_a-zA-Z\.0-9:]+)/.exec(url);
    if (m) return m[1];
    return url;
  }

  // find the relay iframe in the opener
  function findRelay() {
    var loc = window.location;
    var frames = window.opener.frames;
    for (var i = frames.length - 1; i >= 0; i--) {
      try {
        if (frames[i].location.protocol === window.location.protocol &&
            frames[i].location.host === window.location.host &&
            frames[i].name === RELAY_FRAME_NAME)
        {
          return frames[i];
        }
      } catch(e) { }
    }
    return;
  }

  var isIE = isInternetExplorer();

  if (isSupported()) {
    /*  General flow:
     *                  0. user clicks
     *  (IE SPECIFIC)   1. caller adds relay iframe (served from trusted domain) to DOM
     *                  2. caller opens window (with content from trusted domain)
     *                  3. window on opening adds a listener to 'message'
     *  (IE SPECIFIC)   4. window on opening finds iframe
     *                  5. window checks if iframe is "loaded" - has a 'doPost' function yet
     *  (IE SPECIFIC5)  5a. if iframe.doPost exists, window uses it to send ready event to caller
     *  (IE SPECIFIC5)  5b. if iframe.doPost doesn't exist, window waits for frame ready
     *  (IE SPECIFIC5)  5bi. once ready, window calls iframe.doPost to send ready event
     *                  6. caller upon reciept of 'ready', sends args
     */
    return {
      open: function(opts, cb) {
        if (!cb) throw "missing required callback argument";

        // test required options
        var err;
        if (!opts.url) err = "missing required 'url' parameter";
        if (!opts.relay_url) err = "missing required 'relay_url' parameter";
        if (err) setTimeout(function() { cb(err); }, 0);

        // supply default options
        if (!opts.window_name) opts.window_name = null;
        if (!opts.window_features || isFennec()) opts.window_features = undefined;

        // opts.params may be undefined

        var iframe;

        // sanity check, are url and relay_url the same origin?
        var origin = extractOrigin(opts.url);
        if (origin !== extractOrigin(opts.relay_url)) {
          return setTimeout(function() {
            cb('invalid arguments: origin of url and relay_url must match');
          }, 0);
        }

        var messageTarget;

        if (isIE) {
          // first we need to add a "relay" iframe to the document that's served
          // from the target domain.  We can postmessage into a iframe, but not a
          // window
          iframe = document.createElement("iframe");
          // iframe.setAttribute('name', framename);
          iframe.setAttribute('src', opts.relay_url);
          iframe.style.display = "none";
          iframe.setAttribute('name', RELAY_FRAME_NAME);
          document.body.appendChild(iframe);
          messageTarget = iframe.contentWindow;
        }

        var w = opts.popup || window.open(opts.url, opts.window_name, opts.window_features);
        if (opts.popup) {
          w.location.href = opts.url;
        }

        if (!messageTarget) messageTarget = w;

        // lets listen in case the window blows up before telling us
        var closeInterval = setInterval(function() {
          if (w && w.closed) {
            cleanup();
            if (cb) {
              cb('User closed the popup window');
              cb = null;
            }
          }
        }, 500);

        var req = JSON.stringify({a: 'request', d: opts.params});

        // cleanup on unload
        function cleanup() {
          if (iframe) document.body.removeChild(iframe);
          iframe = undefined;
          if (closeInterval) closeInterval = clearInterval(closeInterval);
          removeListener(window, 'message', onMessage);
          removeListener(window, 'unload', cleanup);
          if (w) {
            try {
              w.close();
            } catch (securityViolation) {
              // This happens in Opera 12 sometimes
              // see https://github.com/mozilla/browserid/issues/1844
              messageTarget.postMessage(CLOSE_CMD, origin);
            }
          }
          w = messageTarget = undefined;
        }

        addListener(window, 'unload', cleanup);

        function onMessage(e) {
          if (e.origin !== origin) { return; }
          try {
            var d = JSON.parse(e.data);
            if (d.a === 'ready') messageTarget.postMessage(req, origin);
            else if (d.a === 'error') {
              cleanup();
              if (cb) {
                cb(d.d);
                cb = null;
              }
            } else if (d.a === 'response') {
              cleanup();
              if (cb) {
                cb(null, d.d);
                cb = null;
              }
            }
          } catch(err) { }
        }

        addListener(window, 'message', onMessage);

        return {
          close: cleanup,
          focus: function() {
            if (w) {
              try {
                w.focus();
              } catch (e) {
                // IE7 blows up here, do nothing
              }
            }
          }
        };
      },
      onOpen: function(cb) {
        var o = "*";
        var msgTarget = isIE ? findRelay() : window.opener;
        if (!msgTarget) throw "can't find relay frame";
        function doPost(msg) {
          msg = JSON.stringify(msg);
          if (isIE) msgTarget.doPost(msg, o);
          else msgTarget.postMessage(msg, o);
        }

        function onMessage(e) {
          // only one message gets through, but let's make sure it's actually
          // the message we're looking for (other code may be using
          // postmessage) - we do this by ensuring the payload can
          // be parsed, and it's got an 'a' (action) value of 'request'.
          var d;
          try {
            d = JSON.parse(e.data);
          } catch(err) { }
          if (!d || d.a !== 'request') return;
          removeListener(window, 'message', onMessage);
          o = e.origin;
          if (cb) {
            // this setTimeout is critically important for IE8 -
            // in ie8 sometimes addListener for 'message' can synchronously
            // cause your callback to be invoked.  awesome.
            setTimeout(function() {
              cb(o, d.d, function(r) {
                cb = undefined;
                doPost({a: 'response', d: r});
              });
            }, 0);
          }
        }

        function onDie(e) {
          if (e.data === CLOSE_CMD) {
            try { window.close(); } catch (o_O) {}
          }
        }
        addListener(isIE ? msgTarget : window, 'message', onMessage);
        addListener(isIE ? msgTarget : window, 'message', onDie);

        // we cannot post to our parent that we're ready before the iframe
        // is loaded. (IE specific possible failure)
        try {
          doPost({a: "ready"});
        } catch(e) {
          // this code should never be exectued outside IE
          addListener(msgTarget, 'load', function(e) {
            doPost({a: "ready"});
          });
        }

        // if window is unloaded and the client hasn't called cb, it's an error
        var onUnload = function() {
          try {
            // IE8 doesn't like this...
            removeListener(isIE ? msgTarget : window, 'message', onDie);
          } catch (ohWell) { }
          if (cb) doPost({ a: 'error', d: 'client closed window' });
          cb = undefined;
          // explicitly close the window, in case the client is trying to reload or nav
          try { window.close(); } catch (e) { }
        };
        addListener(window, 'unload', onUnload);
        return {
          detach: function() {
            removeListener(window, 'unload', onUnload);
          }
        };
      }
    };
  } else {
    return {
      open: function(url, winopts, arg, cb) {
        setTimeout(function() { cb("unsupported browser"); }, 0);
      },
      onOpen: function(cb) {
        setTimeout(function() { cb("unsupported browser"); }, 0);
      }
    };
  }
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WinChan;
}

},{}],20:[function(require,module,exports){
module.exports = hasKeys

function hasKeys(source) {
    return source !== null &&
        (typeof source === "object" ||
        typeof source === "function")
}

},{}],21:[function(require,module,exports){
var Keys = require("object-keys")
var hasKeys = require("./has-keys")

module.exports = extend

function extend() {
    var target = {}

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i]

        if (!hasKeys(source)) {
            continue
        }

        var keys = Keys(source)

        for (var j = 0; j < keys.length; j++) {
            var name = keys[j]
            target[name] = source[name]
        }
    }

    return target
}

},{"./has-keys":20,"object-keys":23}],22:[function(require,module,exports){
var hasOwn = Object.prototype.hasOwnProperty;
var toString = Object.prototype.toString;

var isFunction = function (fn) {
	var isFunc = (typeof fn === 'function' && !(fn instanceof RegExp)) || toString.call(fn) === '[object Function]';
	if (!isFunc && typeof window !== 'undefined') {
		isFunc = fn === window.setTimeout || fn === window.alert || fn === window.confirm || fn === window.prompt;
	}
	return isFunc;
};

module.exports = function forEach(obj, fn) {
	if (!isFunction(fn)) {
		throw new TypeError('iterator must be a function');
	}
	var i, k,
		isString = typeof obj === 'string',
		l = obj.length,
		context = arguments.length > 2 ? arguments[2] : null;
	if (l === +l) {
		for (i = 0; i < l; i++) {
			if (context === null) {
				fn(isString ? obj.charAt(i) : obj[i], i, obj);
			} else {
				fn.call(context, isString ? obj.charAt(i) : obj[i], i, obj);
			}
		}
	} else {
		for (k in obj) {
			if (hasOwn.call(obj, k)) {
				if (context === null) {
					fn(obj[k], k, obj);
				} else {
					fn.call(context, obj[k], k, obj);
				}
			}
		}
	}
};


},{}],23:[function(require,module,exports){
module.exports = Object.keys || require('./shim');


},{"./shim":25}],24:[function(require,module,exports){
var toString = Object.prototype.toString;

module.exports = function isArguments(value) {
	var str = toString.call(value);
	var isArguments = str === '[object Arguments]';
	if (!isArguments) {
		isArguments = str !== '[object Array]'
			&& value !== null
			&& typeof value === 'object'
			&& typeof value.length === 'number'
			&& value.length >= 0
			&& toString.call(value.callee) === '[object Function]';
	}
	return isArguments;
};


},{}],25:[function(require,module,exports){
(function () {
	"use strict";

	// modified from https://github.com/kriskowal/es5-shim
	var has = Object.prototype.hasOwnProperty,
		toString = Object.prototype.toString,
		forEach = require('./foreach'),
		isArgs = require('./isArguments'),
		hasDontEnumBug = !({'toString': null}).propertyIsEnumerable('toString'),
		hasProtoEnumBug = (function () {}).propertyIsEnumerable('prototype'),
		dontEnums = [
			"toString",
			"toLocaleString",
			"valueOf",
			"hasOwnProperty",
			"isPrototypeOf",
			"propertyIsEnumerable",
			"constructor"
		],
		keysShim;

	keysShim = function keys(object) {
		var isObject = object !== null && typeof object === 'object',
			isFunction = toString.call(object) === '[object Function]',
			isArguments = isArgs(object),
			theKeys = [];

		if (!isObject && !isFunction && !isArguments) {
			throw new TypeError("Object.keys called on a non-object");
		}

		if (isArguments) {
			forEach(object, function (value) {
				theKeys.push(value);
			});
		} else {
			var name,
				skipProto = hasProtoEnumBug && isFunction;

			for (name in object) {
				if (!(skipProto && name === 'prototype') && has.call(object, name)) {
					theKeys.push(name);
				}
			}
		}

		if (hasDontEnumBug) {
			var ctor = object.constructor,
				skipConstructor = ctor && ctor.prototype === object;

			forEach(dontEnums, function (dontEnum) {
				if (!(skipConstructor && dontEnum === 'constructor') && has.call(object, dontEnum)) {
					theKeys.push(dontEnum);
				}
			});
		}
		return theKeys;
	};

	module.exports = keysShim;
}());


},{"./foreach":22,"./isArguments":24}],26:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};/*
 *
 * This is used to build the bundle with browserify.
 *
 * The bundle is used by people who doesn't use browserify.
 * Those who use browserify will install with npm and require the module,
 * the package.json file points to index.js.
 */
var Auth0 = require('./index');

//use amd or just throught to window object.
if (typeof global.window.define == 'function' && global.window.define.amd) {
  global.window.define('auth0', function () { return Auth0; });
} else if (global.window) {
  global.window.Auth0 = Auth0;
}

},{"./index":1}],27:[function(require,module,exports){
module.exports={"version":"6.7.3"}
},{}]},{},[26])
//@ sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9pbmRleC5qcyIsIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9saWIvTG9naW5FcnJvci5qcyIsIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9saWIvYXNzZXJ0X3JlcXVpcmVkLmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L2xpYi9iYXNlNjRfdXJsLmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L2xpYi9pbmRleC1vZi5qcyIsIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9saWIvaXMtYXJyYXkuanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbGliL2pzb24tcGFyc2UuanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbGliL3NhbWUtb3JpZ2luLmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L2xpYi91c2VfanNvbnAuanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbm9kZV9tb2R1bGVzL0Jhc2U2NC9iYXNlNjQuanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbm9kZV9tb2R1bGVzL2RlYnVnL2Jyb3dzZXIuanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbm9kZV9tb2R1bGVzL2RlYnVnL2RlYnVnLmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L25vZGVfbW9kdWxlcy9kZWJ1Zy9ub2RlX21vZHVsZXMvbXMvaW5kZXguanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbm9kZV9tb2R1bGVzL2pzb24tZmFsbGJhY2svaW5kZXguanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbm9kZV9tb2R1bGVzL2pzb25wL2luZGV4LmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L25vZGVfbW9kdWxlcy9xcy9pbmRleC5qcyIsIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9ub2RlX21vZHVsZXMvcmVxd2VzdC9yZXF3ZXN0LmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L25vZGVfbW9kdWxlcy90cmltL2luZGV4LmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L25vZGVfbW9kdWxlcy93aW5jaGFuL3dpbmNoYW4uanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbm9kZV9tb2R1bGVzL3h0ZW5kL2hhcy1rZXlzLmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L25vZGVfbW9kdWxlcy94dGVuZC9pbmRleC5qcyIsIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9ub2RlX21vZHVsZXMveHRlbmQvbm9kZV9tb2R1bGVzL29iamVjdC1rZXlzL2ZvcmVhY2guanMiLCIvaG9tZS91YnVudHUvLnN0cmlkZXIvZGF0YS9hdXRoMC1hdXRoMC5qcy01NjE3ZDJiNTVjZWVhMjA1N2NjMTJjNjQvbm9kZV9tb2R1bGVzL3h0ZW5kL25vZGVfbW9kdWxlcy9vYmplY3Qta2V5cy9pbmRleC5qcyIsIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9ub2RlX21vZHVsZXMveHRlbmQvbm9kZV9tb2R1bGVzL29iamVjdC1rZXlzL2lzQXJndW1lbnRzLmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L25vZGVfbW9kdWxlcy94dGVuZC9ub2RlX21vZHVsZXMvb2JqZWN0LWtleXMvc2hpbS5qcyIsIi9ob21lL3VidW50dS8uc3RyaWRlci9kYXRhL2F1dGgwLWF1dGgwLmpzLTU2MTdkMmI1NWNlZWEyMDU3Y2MxMmM2NC9zdGFuZGFsb25lLmpzIiwiL2hvbWUvdWJ1bnR1Ly5zdHJpZGVyL2RhdGEvYXV0aDAtYXV0aDAuanMtNTYxN2QyYjU1Y2VlYTIwNTdjYzEyYzY0L3ZlcnNpb24uanNvbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2x5REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0dBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyZUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdm1CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hDQTtBQUNBO0FBQ0E7O0FDRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hCQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsidmFyIGdsb2JhbD10eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge307LyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbnZhciBCYXNlNjRVcmwgICAgICAgICA9IHJlcXVpcmUoJy4vbGliL2Jhc2U2NF91cmwnKTtcbnZhciBhc3NlcnRfcmVxdWlyZWQgICA9IHJlcXVpcmUoJy4vbGliL2Fzc2VydF9yZXF1aXJlZCcpO1xudmFyIGlzX2FycmF5ICAgICAgICAgID0gcmVxdWlyZSgnLi9saWIvaXMtYXJyYXknKTtcbnZhciBpbmRleF9vZiAgICAgICAgICA9IHJlcXVpcmUoJy4vbGliL2luZGV4LW9mJyk7XG5cbnZhciBxcyAgICAgICAgICAgICAgICA9IHJlcXVpcmUoJ3FzJyk7XG52YXIgeHRlbmQgICAgICAgICAgICAgPSByZXF1aXJlKCd4dGVuZCcpO1xudmFyIHRyaW0gICAgICAgICAgICAgID0gcmVxdWlyZSgndHJpbScpO1xudmFyIHJlcXdlc3QgICAgICAgICAgID0gcmVxdWlyZSgncmVxd2VzdCcpO1xudmFyIFdpbkNoYW4gICAgICAgICAgID0gcmVxdWlyZSgnd2luY2hhbicpO1xuXG52YXIganNvbnAgICAgICAgICAgICAgPSByZXF1aXJlKCdqc29ucCcpO1xudmFyIGpzb25wT3B0cyAgICAgICAgID0geyBwYXJhbTogJ2NieCcsIHRpbWVvdXQ6IDgwMDAsIHByZWZpeDogJ19fYXV0aDBqcCcgfTtcblxudmFyIHNhbWVfb3JpZ2luICAgICAgID0gcmVxdWlyZSgnLi9saWIvc2FtZS1vcmlnaW4nKTtcbnZhciBqc29uX3BhcnNlICAgICAgICA9IHJlcXVpcmUoJy4vbGliL2pzb24tcGFyc2UnKTtcbnZhciBMb2dpbkVycm9yICAgICAgICA9IHJlcXVpcmUoJy4vbGliL0xvZ2luRXJyb3InKTtcbnZhciB1c2VfanNvbnAgICAgICAgICA9IHJlcXVpcmUoJy4vbGliL3VzZV9qc29ucCcpO1xuXG4vKipcbiAqIENoZWNrIGlmIHJ1bm5pbmcgaW4gSUUuXG4gKlxuICogQHJldHVybnMge051bWJlcn0gLTEgaWYgbm90IElFLCBJRSB2ZXJzaW9uIG90aGVyd2lzZS5cbiAqL1xuZnVuY3Rpb24gaXNJbnRlcm5ldEV4cGxvcmVyKCkge1xuICB2YXIgcnYgPSAtMTsgLy8gUmV0dXJuIHZhbHVlIGFzc3VtZXMgZmFpbHVyZS5cbiAgdmFyIHVhID0gbmF2aWdhdG9yLnVzZXJBZ2VudDtcbiAgdmFyIHJlO1xuICBpZiAobmF2aWdhdG9yLmFwcE5hbWUgPT09ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInKSB7XG4gICAgcmUgPSBuZXcgUmVnRXhwKCdNU0lFIChbMC05XXsxLH1bXFwuMC05XXswLH0pJyk7XG4gICAgaWYgKHJlLmV4ZWModWEpICE9IG51bGwpIHtcbiAgICAgIHJ2ID0gcGFyc2VGbG9hdChSZWdFeHAuJDEpO1xuICAgIH1cbiAgfVxuICAvLyBJRSA+IDExXG4gIGVsc2UgaWYgKHVhLmluZGV4T2YoJ1RyaWRlbnQnKSA+IC0xKSB7XG4gICAgcmUgPSBuZXcgUmVnRXhwKCdydjooWzAtOV17MiwyfVtcXC4wLTldezAsfSknKTtcbiAgICBpZiAocmUuZXhlYyh1YSkgIT09IG51bGwpIHtcbiAgICAgIHJ2ID0gcGFyc2VGbG9hdChSZWdFeHAuJDEpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBydjtcbn1cblxuLyoqXG4gKiBTdHJpbmdpZnkgcG9wdXAgb3B0aW9ucyBvYmplY3QgaW50b1xuICogYHdpbmRvdy5vcGVuYCBzdHJpbmcgb3B0aW9ucyBmb3JtYXRcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcG9wdXBPcHRpb25zXG4gKiBAcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHN0cmluZ2lmeVBvcHVwU2V0dGluZ3MocG9wdXBPcHRpb25zKSB7XG4gIHZhciBzZXR0aW5ncyA9ICcnO1xuXG4gIGZvciAodmFyIGtleSBpbiBwb3B1cE9wdGlvbnMpIHtcbiAgICBzZXR0aW5ncyArPSBrZXkgKyAnPScgKyBwb3B1cE9wdGlvbnNba2V5XSArICcsJztcbiAgfVxuXG4gIHJldHVybiBzZXR0aW5ncy5zbGljZSgwLCAtMSk7XG59XG5cblxuLyoqXG4gKiBDaGVjayB0aGF0IGEga2V5IGhhcyBiZWVuIHNldCB0byBzb21ldGhpbmcgZGlmZmVyZW50IHRoYW4gbnVsbFxuICogb3IgdW5kZWZpbmVkLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7U3RyaW5nfSBrZXlcbiAqL1xuZnVuY3Rpb24gY2hlY2tJZlNldChvYmosIGtleSkge1xuICAvKlxuICAgKiBmYWxzZSAgICAgICE9IG51bGwgLT4gdHJ1ZVxuICAgKiB0cnVlICAgICAgICE9IG51bGwgLT4gdHJ1ZVxuICAgKiB1bmRlZmluZWQgICE9IG51bGwgLT4gZmFsc2VcbiAgICogbnVsbCAgICAgICAhPSBudWxsIC0+IGZhbHNlXG4gICAqL1xuICByZXR1cm4gISEob2JqICYmIG9ialtrZXldICE9IG51bGwpO1xufVxuXG5mdW5jdGlvbiBoYW5kbGVSZXF1ZXN0RXJyb3IoZXJyLCBjYWxsYmFjaykge1xuICB2YXIgZXIgPSBlcnI7XG4gIHZhciBpc0FmZmVjdGVkSUVWZXJzaW9uID0gaXNJbnRlcm5ldEV4cGxvcmVyKCkgPT09IDEwIHx8IGlzSW50ZXJuZXRFeHBsb3JlcigpID09PSAxMTtcbiAgdmFyIHplcm9TdGF0dXMgPSAoIWVyLnN0YXR1cyB8fCBlci5zdGF0dXMgPT09IDApO1xuXG4gIHZhciBvbkxpbmUgPSAhIXdpbmRvdy5uYXZpZ2F0b3Iub25MaW5lO1xuXG4gIC8vIFJlcXVlc3QgZmFpbGVkIGJlY2F1c2Ugd2UgYXJlIG9mZmxpbmUuXG4gIGlmICh6ZXJvU3RhdHVzICYmICFvbkxpbmUgKSB7XG4gICAgZXIgPSB7fTtcbiAgICBlci5zdGF0dXMgPSAwO1xuICAgIGVyLnJlc3BvbnNlVGV4dCA9IHtcbiAgICAgIGNvZGU6ICdvZmZsaW5lJ1xuICAgIH07XG4gIC8vIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMjMyMjk3MjMvaWUtMTAtMTEtY29ycy1zdGF0dXMtMFxuICAvLyBYWFggSUUxMCB3aGVuIGEgcmVxdWVzdCBmYWlscyBpbiBDT1JTIHJldHVybnMgc3RhdHVzIGNvZGUgMFxuICAvLyBTZWU6IGh0dHA6Ly9jYW5pdXNlLmNvbS8jc2VhcmNoPW5hdmlnYXRvci5vbkxpbmVcbiAgfSBlbHNlIGlmICh6ZXJvU3RhdHVzICYmIGlzQWZmZWN0ZWRJRVZlcnNpb24pIHtcbiAgICBlciA9IHt9O1xuICAgIGVyLnN0YXR1cyA9IDQwMTtcbiAgICBlci5yZXNwb25zZVRleHQgPSB7XG4gICAgICBjb2RlOiAnaW52YWxpZF91c2VyX3Bhc3N3b3JkJ1xuICAgIH07XG4gIC8vIElmIG5vdCBJRTEwLzExIGFuZCBub3Qgb2ZmbGluZSBpdCBtZWFucyB0aGF0IEF1dGgwIGhvc3QgaXMgdW5yZWFjaGFibGU6XG4gIC8vIENvbm5lY3Rpb24gVGltZW91dCBvciBDb25uZWN0aW9uIFJlZnVzZWQuXG4gIH0gZWxzZSBpZiAoemVyb1N0YXR1cykge1xuICAgIGVyID0ge307XG4gICAgZXIuc3RhdHVzID0gMDtcbiAgICBlci5yZXNwb25zZVRleHQgPSB7XG4gICAgICBjb2RlOiAnY29ubmVjdGlvbl9yZWZ1c2VkX3RpbWVvdXQnXG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICBlci5yZXNwb25zZVRleHQgPSBlcnI7XG4gIH1cbiAgdmFyIGVycm9yID0gbmV3IExvZ2luRXJyb3IoZXIuc3RhdHVzLCBlci5yZXNwb25zZVRleHQpO1xuICBjYWxsYmFjayhlcnJvcik7XG59XG5cbi8qKlxuICogam9pbiB1cmwgZnJvbSBwcm90b2NvbFxuICovXG5cbmZ1bmN0aW9uIGpvaW5VcmwocHJvdG9jb2wsIGRvbWFpbiwgZW5kcG9pbnQpIHtcbiAgcmV0dXJuIHByb3RvY29sICsgJy8vJyArIGRvbWFpbiArIGVuZHBvaW50O1xufVxuXG4vKipcbiAqIENyZWF0ZSBhbiBgQXV0aDBgIGluc3RhbmNlIHdpdGggYG9wdGlvbnNgXG4gKlxuICogQGNsYXNzIEF1dGgwXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gQXV0aDAgKG9wdGlvbnMpIHtcbiAgLy8gWFhYIERlcHJlY2F0ZWQ6IFdlIHByZWZlciBuZXcgQXV0aDAoLi4uKVxuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQXV0aDApKSB7XG4gICAgcmV0dXJuIG5ldyBBdXRoMChvcHRpb25zKTtcbiAgfVxuXG4gIGFzc2VydF9yZXF1aXJlZChvcHRpb25zLCAnY2xpZW50SUQnKTtcbiAgYXNzZXJ0X3JlcXVpcmVkKG9wdGlvbnMsICdkb21haW4nKTtcblxuICB0aGlzLl91c2VKU09OUCA9IG51bGwgIT0gb3B0aW9ucy5mb3JjZUpTT05QID9cbiAgICAgICAgICAgICAgICAgICAgISFvcHRpb25zLmZvcmNlSlNPTlAgOlxuICAgICAgICAgICAgICAgICAgICB1c2VfanNvbnAoKSAmJiAhc2FtZV9vcmlnaW4oJ2h0dHBzOicsIG9wdGlvbnMuZG9tYWluKTtcblxuICB0aGlzLl9jbGllbnRJRCA9IG9wdGlvbnMuY2xpZW50SUQ7XG4gIHRoaXMuX2NhbGxiYWNrVVJMID0gb3B0aW9ucy5jYWxsYmFja1VSTCB8fCBkb2N1bWVudC5sb2NhdGlvbi5ocmVmO1xuICB0aGlzLl9zaG91bGRSZWRpcmVjdCA9ICEhb3B0aW9ucy5jYWxsYmFja1VSTDtcbiAgdGhpcy5fZG9tYWluID0gb3B0aW9ucy5kb21haW47XG4gIHRoaXMuX2NhbGxiYWNrT25Mb2NhdGlvbkhhc2ggPSBmYWxzZSB8fCBvcHRpb25zLmNhbGxiYWNrT25Mb2NhdGlvbkhhc2g7XG4gIHRoaXMuX2NvcmRvdmFTb2NpYWxQbHVnaW5zID0ge1xuICAgIGZhY2Vib29rOiB0aGlzLl9waG9uZWdhcEZhY2Vib29rTG9naW5cbiAgfTtcbiAgdGhpcy5fdXNlQ29yZG92YVNvY2lhbFBsdWdpbnMgPSBmYWxzZSB8fCBvcHRpb25zLnVzZUNvcmRvdmFTb2NpYWxQbHVnaW5zO1xuICB0aGlzLl9zZW5kQ2xpZW50SW5mbyA9IG51bGwgIT0gb3B0aW9ucy5zZW5kU0RLQ2xpZW50SW5mbyA/IG9wdGlvbnMuc2VuZFNES0NsaWVudEluZm8gOiB0cnVlO1xufVxuXG4vKipcbiAqIEV4cG9ydCB2ZXJzaW9uIHdpdGggYEF1dGgwYCBjb25zdHJ1Y3RvclxuICpcbiAqIEBwcm9wZXJ0eSB7U3RyaW5nfSB2ZXJzaW9uXG4gKi9cblxuQXV0aDAudmVyc2lvbiA9IHJlcXVpcmUoJy4vdmVyc2lvbi5qc29uJykudmVyc2lvbjtcblxuLyoqXG4gKiBFeHBvcnQgY2xpZW50IGluZm8gb2JqZWN0XG4gKlxuICpcbiAqIEBwcm9wZXJ0eSB7SGFzaH1cbiAqL1xuXG5BdXRoMC5jbGllbnRJbmZvID0geyBuYW1lOiAnYXV0aDAuanMnLCB2ZXJzaW9uOiBBdXRoMC52ZXJzaW9uIH07XG5cblxuLyoqXG4gKiBSZWRpcmVjdCBjdXJyZW50IGxvY2F0aW9uIHRvIGB1cmxgXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHByaXZhdGVcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuX3JlZGlyZWN0ID0gZnVuY3Rpb24gKHVybCkge1xuICBnbG9iYWwud2luZG93LmxvY2F0aW9uID0gdXJsO1xufTtcblxuQXV0aDAucHJvdG90eXBlLl9nZXRDYWxsYmFja09uTG9jYXRpb25IYXNoID0gZnVuY3Rpb24ob3B0aW9ucykge1xuICByZXR1cm4gKG9wdGlvbnMgJiYgdHlwZW9mIG9wdGlvbnMuY2FsbGJhY2tPbkxvY2F0aW9uSGFzaCAhPT0gJ3VuZGVmaW5lZCcpID9cbiAgICBvcHRpb25zLmNhbGxiYWNrT25Mb2NhdGlvbkhhc2ggOiB0aGlzLl9jYWxsYmFja09uTG9jYXRpb25IYXNoO1xufTtcblxuQXV0aDAucHJvdG90eXBlLl9nZXRDYWxsYmFja1VSTCA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgcmV0dXJuIChvcHRpb25zICYmIHR5cGVvZiBvcHRpb25zLmNhbGxiYWNrVVJMICE9PSAndW5kZWZpbmVkJykgP1xuICAgIG9wdGlvbnMuY2FsbGJhY2tVUkwgOiB0aGlzLl9jYWxsYmFja1VSTDtcbn07XG5cbkF1dGgwLnByb3RvdHlwZS5fZ2V0Q2xpZW50SW5mb1N0cmluZyA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGNsaWVudEluZm8gPSBKU09OLnN0cmluZ2lmeShBdXRoMC5jbGllbnRJbmZvKTtcbiAgcmV0dXJuIEJhc2U2NFVybC5lbmNvZGUoY2xpZW50SW5mbyk7XG59O1xuXG5BdXRoMC5wcm90b3R5cGUuX2dldENsaWVudEluZm9IZWFkZXIgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB7XG4gICAgJ0F1dGgwLUNsaWVudCc6IHRoaXMuX2dldENsaWVudEluZm9TdHJpbmcoKVxuICB9O1xufTtcblxuLyoqXG4gKiBSZW5kZXJzIGFuZCBzdWJtaXRzIGEgV1NGZWQgZm9ybVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmb3JtSHRtbFxuICogQHByaXZhdGVcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuX3JlbmRlckFuZFN1Ym1pdFdTRmVkRm9ybSA9IGZ1bmN0aW9uIChvcHRpb25zLCBmb3JtSHRtbCkge1xuICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGRpdi5pbm5lckhUTUwgPSBmb3JtSHRtbDtcbiAgdmFyIGZvcm0gPSBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRpdikuY2hpbGRyZW5bMF07XG5cbiAgaWYgKG9wdGlvbnMucG9wdXAgJiYgIXRoaXMuX2dldENhbGxiYWNrT25Mb2NhdGlvbkhhc2gob3B0aW9ucykpIHtcbiAgICBmb3JtLnRhcmdldCA9ICdhdXRoMF9zaWdudXBfcG9wdXAnO1xuICB9XG5cbiAgZm9ybS5zdWJtaXQoKTtcbn07XG5cbi8qKlxuICogUmVzb2x2ZSByZXNwb25zZSB0eXBlIGFzIGB0b2tlbmAgb3IgYGNvZGVgXG4gKlxuICogQHJldHVybiB7T2JqZWN0fSBgc2NvcGVgIGFuZCBgcmVzcG9uc2VfdHlwZWAgcHJvcGVydGllc1xuICogQHByaXZhdGVcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuX2dldE1vZGUgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIHNjb3BlOiAnb3BlbmlkJyxcbiAgICByZXNwb25zZV90eXBlOiB0aGlzLl9nZXRDYWxsYmFja09uTG9jYXRpb25IYXNoKG9wdGlvbnMpID8gJ3Rva2VuJyA6ICdjb2RlJ1xuICB9O1xufTtcblxuQXV0aDAucHJvdG90eXBlLl9jb25maWd1cmVPZmZsaW5lTW9kZSA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgaWYgKG9wdGlvbnMuc2NvcGUgJiYgb3B0aW9ucy5zY29wZS5pbmRleE9mKCdvZmZsaW5lX2FjY2VzcycpID49IDApIHtcbiAgICBvcHRpb25zLmRldmljZSA9IG9wdGlvbnMuZGV2aWNlIHx8ICdCcm93c2VyJztcbiAgfVxufTtcblxuLyoqXG4gKiBHZXQgdXNlciBpbmZvcm1hdGlvbiBmcm9tIEFQSVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwcm9maWxlXG4gKiBAcGFyYW0ge1N0cmluZ30gaWRfdG9rZW5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrXG4gKiBAcHJpdmF0ZVxuICovXG5cbkF1dGgwLnByb3RvdHlwZS5fZ2V0VXNlckluZm8gPSBmdW5jdGlvbiAocHJvZmlsZSwgaWRfdG9rZW4sIGNhbGxiYWNrKSB7XG5cbiAgaWYgKCEocHJvZmlsZSAmJiAhcHJvZmlsZS51c2VyX2lkKSkge1xuICAgIHJldHVybiBjYWxsYmFjayhudWxsLCBwcm9maWxlKTtcbiAgfVxuXG4gIC8vIHRoZSBzY29wZSB3YXMganVzdCBvcGVuaWRcbiAgdmFyIF90aGlzID0gdGhpcztcbiAgdmFyIHByb3RvY29sID0gJ2h0dHBzOic7XG4gIHZhciBkb21haW4gPSB0aGlzLl9kb21haW47XG4gIHZhciBlbmRwb2ludCA9ICcvdG9rZW5pbmZvJztcbiAgdmFyIHVybCA9IGpvaW5VcmwocHJvdG9jb2wsIGRvbWFpbiwgZW5kcG9pbnQpO1xuXG4gIHZhciBmYWlsID0gZnVuY3Rpb24gKHN0YXR1cywgZGVzY3JpcHRpb24pIHtcbiAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3Ioc3RhdHVzICsgJzogJyArIChkZXNjcmlwdGlvbiB8fCAnJykpO1xuXG4gICAgLy8gVGhlc2UgdHdvIHByb3BlcnRpZXMgYXJlIGFkZGVkIGZvciBjb21wYXRpYmlsaXR5IHdpdGggb2xkIHZlcnNpb25zIChubyBFcnJvciBpbnN0YW5jZSB3YXMgcmV0dXJuZWQpXG4gICAgZXJyb3IuZXJyb3IgPSBzdGF0dXM7XG4gICAgZXJyb3IuZXJyb3JfZGVzY3JpcHRpb24gPSBkZXNjcmlwdGlvbjtcblxuICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgfTtcblxuICBpZiAodGhpcy5fdXNlSlNPTlApIHtcbiAgICByZXR1cm4ganNvbnAodXJsICsgJz8nICsgcXMuc3RyaW5naWZ5KHtpZF90b2tlbjogaWRfdG9rZW59KSwganNvbnBPcHRzLCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiBmYWlsKDAsIGVyci50b1N0cmluZygpKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3Auc3RhdHVzID09PSAyMDAgP1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXNwLnVzZXIpIDpcbiAgICAgICAgZmFpbChyZXNwLnN0YXR1cywgcmVzcC5lcnIgfHwgcmVzcC5lcnJvcik7XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gcmVxd2VzdCh7XG4gICAgdXJsOiAgICAgICAgICBzYW1lX29yaWdpbihwcm90b2NvbCwgZG9tYWluKSA/IGVuZHBvaW50IDogdXJsLFxuICAgIG1ldGhvZDogICAgICAgJ3Bvc3QnLFxuICAgIHR5cGU6ICAgICAgICAgJ2pzb24nLFxuICAgIGNyb3NzT3JpZ2luOiAgIXNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pLFxuICAgIGRhdGE6ICAgICAgICAge2lkX3Rva2VuOiBpZF90b2tlbn1cbiAgfSkuZmFpbChmdW5jdGlvbiAoZXJyKSB7XG4gICAgZmFpbChlcnIuc3RhdHVzLCBlcnIucmVzcG9uc2VUZXh0KTtcbiAgfSkudGhlbihmdW5jdGlvbiAodXNlcmluZm8pIHtcbiAgICBjYWxsYmFjayhudWxsLCB1c2VyaW5mbyk7XG4gIH0pO1xuXG59O1xuXG4vKipcbiAqIEdldCBwcm9maWxlIGRhdGEgYnkgYGlkX3Rva2VuYFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBpZF90b2tlblxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2tcbiAqIEBtZXRob2QgZ2V0UHJvZmlsZVxuICovXG5cbkF1dGgwLnByb3RvdHlwZS5nZXRQcm9maWxlID0gZnVuY3Rpb24gKGlkX3Rva2VuLCBjYWxsYmFjaykge1xuICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNhbGxiYWNrKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdBIGNhbGxiYWNrIGZ1bmN0aW9uIGlzIHJlcXVpcmVkJyk7XG4gIH1cbiAgaWYgKCFpZF90b2tlbiB8fCB0eXBlb2YgaWRfdG9rZW4gIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBFcnJvcignSW52YWxpZCB0b2tlbicpKTtcbiAgfVxuXG4gIHRoaXMuX2dldFVzZXJJbmZvKHRoaXMuZGVjb2RlSnd0KGlkX3Rva2VuKSwgaWRfdG9rZW4sIGNhbGxiYWNrKTtcbn07XG5cbi8qKlxuICogVmFsaWRhdGUgYSB1c2VyXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrXG4gKiBAbWV0aG9kIHZhbGlkYXRlVXNlclxuICovXG5cbkF1dGgwLnByb3RvdHlwZS52YWxpZGF0ZVVzZXIgPSBmdW5jdGlvbiAob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIHByb3RvY29sID0gJ2h0dHBzOic7XG4gIHZhciBkb21haW4gPSB0aGlzLl9kb21haW47XG4gIHZhciBlbmRwb2ludCA9ICcvcHVibGljL2FwaS91c2Vycy92YWxpZGF0ZV91c2VycGFzc3dvcmQnO1xuICB2YXIgdXJsID0gam9pblVybChwcm90b2NvbCwgZG9tYWluLCBlbmRwb2ludCk7XG5cbiAgdmFyIHF1ZXJ5ID0geHRlbmQoXG4gICAgb3B0aW9ucyxcbiAgICB7XG4gICAgICBjbGllbnRfaWQ6ICAgIHRoaXMuX2NsaWVudElELFxuICAgICAgdXNlcm5hbWU6ICAgICB0cmltKG9wdGlvbnMudXNlcm5hbWUgfHwgb3B0aW9ucy5lbWFpbCB8fCAnJylcbiAgICB9KTtcblxuICBpZiAodGhpcy5fdXNlSlNPTlApIHtcbiAgICByZXR1cm4ganNvbnAodXJsICsgJz8nICsgcXMuc3RyaW5naWZ5KHF1ZXJ5KSwganNvbnBPcHRzLCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgfVxuICAgICAgaWYoJ2Vycm9yJyBpbiByZXNwICYmIHJlc3Auc3RhdHVzICE9PSA0MDQpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBFcnJvcihyZXNwLmVycm9yKSk7XG4gICAgICB9XG4gICAgICBjYWxsYmFjayhudWxsLCByZXNwLnN0YXR1cyA9PT0gMjAwKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlcXdlc3Qoe1xuICAgIHVybDogICAgIHNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pID8gZW5kcG9pbnQgOiB1cmwsXG4gICAgbWV0aG9kOiAgJ3Bvc3QnLFxuICAgIHR5cGU6ICAgICd0ZXh0JyxcbiAgICBkYXRhOiAgICBxdWVyeSxcbiAgICBjcm9zc09yaWdpbjogIXNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pLFxuICAgIGVycm9yOiBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICBpZiAoZXJyLnN0YXR1cyAhPT0gNDA0KSB7IHJldHVybiBjYWxsYmFjayhuZXcgRXJyb3IoZXJyLnJlc3BvbnNlVGV4dCkpOyB9XG4gICAgICBjYWxsYmFjayhudWxsLCBmYWxzZSk7XG4gICAgfSxcbiAgICBzdWNjZXNzOiBmdW5jdGlvbiAocmVzcCkge1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzcC5zdGF0dXMgPT09IDIwMCk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogRGVjb2RlIEpzb24gV2ViIFRva2VuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGp3dFxuICogQG1ldGhvZCBkZWNvZGVKd3RcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuZGVjb2RlSnd0ID0gZnVuY3Rpb24gKGp3dCkge1xuICB2YXIgZW5jb2RlZCA9IGp3dCAmJiBqd3Quc3BsaXQoJy4nKVsxXTtcbiAgcmV0dXJuIGpzb25fcGFyc2UoQmFzZTY0VXJsLmRlY29kZShlbmNvZGVkKSk7XG59O1xuXG4vKipcbiAqIEdpdmVuIHRoZSBoYXNoIChvciBhIHF1ZXJ5KSBvZiBhbiBVUkwgcmV0dXJucyBhIGRpY3Rpb25hcnkgd2l0aCBvbmx5IHJlbGV2YW50XG4gKiBhdXRoZW50aWNhdGlvbiBpbmZvcm1hdGlvbi4gSWYgc3VjY2VlZHMgaXQgd2lsbCByZXR1cm4gdGhlIGZvbGxvd2luZyBmaWVsZHM6XG4gKiBgcHJvZmlsZWAsIGBpZF90b2tlbmAsIGBhY2Nlc3NfdG9rZW5gIGFuZCBgc3RhdGVgLiBJbiBjYXNlIG9mIGVycm9yLCBpdCB3aWxsXG4gKiByZXR1cm4gYGVycm9yYCBhbmQgYGVycm9yX2Rlc2NyaXB0aW9uYC5cbiAqXG4gKiBAbWV0aG9kIHBhcnNlSGFzaFxuICogQHBhcmFtIHtTdHJpbmd9IFtoYXNoPXdpbmRvdy5sb2NhdGlvbi5oYXNoXSBVUkwgdG8gYmUgcGFyc2VkXG4gKiBAZXhhbXBsZVxuICogICAgICB2YXIgYXV0aDAgPSBuZXcgQXV0aDAoey4uLn0pO1xuICpcbiAqICAgICAgLy8gUmV0dXJucyB7cHJvZmlsZTogeyoqIGRlY29kZWQgaWQgdG9rZW4gKip9LCBzdGF0ZTogXCJnb29kXCJ9XG4gKiAgICAgIGF1dGgwLnBhcnNlSGFzaCgnI2lkX3Rva2VuPS4uLi4uJnN0YXRlPWdvb2QmZm9vPWJhcicpO1xuICpcbiAqICAgICAgLy8gUmV0dXJucyB7ZXJyb3I6IFwiaW52YWxpZF9jcmVkZW50aWFsc1wiLCBlcnJvcl9kZXNjcmlwdGlvbjogdW5kZWZpbmVkfVxuICogICAgICBhdXRoMC5wYXJzZUhhc2goJyNlcnJvcj1pbnZhbGlkX2NyZWRlbnRpYWxzJyk7XG4gKlxuICogICAgICAvLyBSZXR1cm5zIHtlcnJvcjogXCJpbnZhbGlkX2NyZWRlbnRpYWxzXCIsIGVycm9yX2Rlc2NyaXB0aW9uOiB1bmRlZmluZWR9XG4gKiAgICAgIGF1dGgwLnBhcnNlSGFzaCgnP2Vycm9yPWludmFsaWRfY3JlZGVudGlhbHMnKTtcbiAqXG4gKi9cblxuQXV0aDAucHJvdG90eXBlLnBhcnNlSGFzaCA9IGZ1bmN0aW9uIChoYXNoKSB7XG4gIGhhc2ggPSBoYXNoIHx8IHdpbmRvdy5sb2NhdGlvbi5oYXNoO1xuICB2YXIgcGFyc2VkX3FzO1xuICBpZiAoaGFzaC5tYXRjaCgvZXJyb3IvKSkge1xuICAgIGhhc2ggPSBoYXNoLnN1YnN0cigxKS5yZXBsYWNlKC9eXFwvLywgJycpO1xuICAgIHBhcnNlZF9xcyA9IHFzLnBhcnNlKGhhc2gpO1xuICAgIHZhciBlcnIgPSB7XG4gICAgICBlcnJvcjogcGFyc2VkX3FzLmVycm9yLFxuICAgICAgZXJyb3JfZGVzY3JpcHRpb246IHBhcnNlZF9xcy5lcnJvcl9kZXNjcmlwdGlvblxuICAgIH07XG4gICAgcmV0dXJuIGVycjtcbiAgfVxuICBpZighaGFzaC5tYXRjaCgvYWNjZXNzX3Rva2VuLykpIHtcbiAgICAvLyBJbnZhbGlkIGhhc2ggVVJMXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaGFzaCA9IGhhc2guc3Vic3RyKDEpLnJlcGxhY2UoL15cXC8vLCAnJyk7XG4gIHBhcnNlZF9xcyA9IHFzLnBhcnNlKGhhc2gpO1xuICB2YXIgaWRfdG9rZW4gPSBwYXJzZWRfcXMuaWRfdG9rZW47XG4gIHZhciByZWZyZXNoX3Rva2VuID0gcGFyc2VkX3FzLnJlZnJlc2hfdG9rZW47XG4gIHZhciBwcm9mID0gdGhpcy5kZWNvZGVKd3QoaWRfdG9rZW4pO1xuICB2YXIgaW52YWxpZEp3dCA9IGZ1bmN0aW9uIChlcnJvcikge1xuICAgIHZhciBlcnIgPSB7XG4gICAgICBlcnJvcjogJ2ludmFsaWRfdG9rZW4nLFxuICAgICAgZXJyb3JfZGVzY3JpcHRpb246IGVycm9yXG4gICAgfTtcbiAgICByZXR1cm4gZXJyO1xuICB9O1xuXG4gIC8vIGF1ZCBzaG91bGQgYmUgdGhlIGNsaWVudElEXG4gIHZhciBhdWRpZW5jZXMgPSBpc19hcnJheShwcm9mLmF1ZCkgPyBwcm9mLmF1ZCA6IFsgcHJvZi5hdWQgXTtcbiAgaWYgKGluZGV4X29mKGF1ZGllbmNlcywgdGhpcy5fY2xpZW50SUQpID09PSAtMSkge1xuICAgIHJldHVybiBpbnZhbGlkSnd0KFxuICAgICAgJ1RoZSBjbGllbnRJRCBjb25maWd1cmVkICgnICsgdGhpcy5fY2xpZW50SUQgKyAnKSBkb2VzIG5vdCBtYXRjaCB3aXRoIHRoZSBjbGllbnRJRCBzZXQgaW4gdGhlIHRva2VuICgnICsgYXVkaWVuY2VzLmpvaW4oJywgJykgKyAnKS4nKTtcbiAgfVxuXG4gIC8vIGlzcyBzaG91bGQgYmUgdGhlIEF1dGgwIGRvbWFpbiAoaS5lLjogaHR0cHM6Ly9jb250b3NvLmF1dGgwLmNvbS8pXG4gIGlmIChwcm9mLmlzcyAmJiBwcm9mLmlzcyAhPT0gJ2h0dHBzOi8vJyArIHRoaXMuX2RvbWFpbiArICcvJykge1xuICAgIHJldHVybiBpbnZhbGlkSnd0KFxuICAgICAgJ1RoZSBkb21haW4gY29uZmlndXJlZCAoaHR0cHM6Ly8nICsgdGhpcy5fZG9tYWluICsgJy8pIGRvZXMgbm90IG1hdGNoIHdpdGggdGhlIGRvbWFpbiBzZXQgaW4gdGhlIHRva2VuICgnICsgcHJvZi5pc3MgKyAnKS4nKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHJvZmlsZTogcHJvZixcbiAgICBpZF90b2tlbjogaWRfdG9rZW4sXG4gICAgYWNjZXNzX3Rva2VuOiBwYXJzZWRfcXMuYWNjZXNzX3Rva2VuLFxuICAgIHN0YXRlOiBwYXJzZWRfcXMuc3RhdGUsXG4gICAgcmVmcmVzaF90b2tlbjogcmVmcmVzaF90b2tlblxuICB9O1xufTtcblxuLyoqXG4gKiBTaWdudXBcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBTaWdudXAgT3B0aW9uc1xuICogQHBhcmFtIHtTdHJpbmd9IGVtYWlsIE5ldyB1c2VyIGVtYWlsXG4gKiBAcGFyYW0ge1N0cmluZ30gcGFzc3dvcmQgTmV3IHVzZXIgcGFzc3dvcmRcbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQG1ldGhvZCBzaWdudXBcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuc2lnbnVwID0gZnVuY3Rpb24gKG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIHZhciBfdGhpcyA9IHRoaXM7XG5cbiAgdmFyIG9wdHMgPSB7XG4gICAgY2xpZW50X2lkOiB0aGlzLl9jbGllbnRJRCxcbiAgICByZWRpcmVjdF91cmk6IHRoaXMuX2dldENhbGxiYWNrVVJMKG9wdGlvbnMpLFxuICAgIHVzZXJuYW1lOiB0cmltKG9wdGlvbnMudXNlcm5hbWUgfHwgJycpLFxuICAgIGVtYWlsOiB0cmltKG9wdGlvbnMuZW1haWwgfHwgb3B0aW9ucy51c2VybmFtZSB8fCAnJyksXG4gICAgdGVuYW50OiB0aGlzLl9kb21haW4uc3BsaXQoJy4nKVswXVxuICB9O1xuXG4gIHZhciBxdWVyeSA9IHh0ZW5kKHRoaXMuX2dldE1vZGUob3B0aW9ucyksIG9wdGlvbnMsIG9wdHMpO1xuXG4gIHRoaXMuX2NvbmZpZ3VyZU9mZmxpbmVNb2RlKHF1ZXJ5KTtcblxuICAvLyBUT0RPIENoYW5nZSB0aGlzIHRvIGEgcHJvcGVydHkgbmFtZWQgJ2Rpc2FibGVTU08nIGZvciBjb25zaXN0ZW5jeS5cbiAgLy8gQnkgZGVmYXVsdCwgb3B0aW9ucy5zc28gaXMgdHJ1ZVxuICBpZiAoIWNoZWNrSWZTZXQob3B0aW9ucywgJ3NzbycpKSB7XG4gICAgb3B0aW9ucy5zc28gPSB0cnVlO1xuICB9XG5cbiAgaWYgKCFjaGVja0lmU2V0KG9wdGlvbnMsICdhdXRvX2xvZ2luJykpIHtcbiAgICBvcHRpb25zLmF1dG9fbG9naW4gPSB0cnVlO1xuICB9XG5cbiAgdmFyIHBvcHVwO1xuXG4gIHZhciB3aWxsX3BvcHVwID0gb3B0aW9ucy5hdXRvX2xvZ2luICYmIG9wdGlvbnMucG9wdXBcbiAgICAmJiAoIXRoaXMuX2dldENhbGxiYWNrT25Mb2NhdGlvbkhhc2gob3B0aW9ucykgfHwgb3B0aW9ucy5zc28pO1xuXG4gIGlmICh3aWxsX3BvcHVwKSB7XG4gICAgcG9wdXAgPSB0aGlzLl9idWlsZFBvcHVwV2luZG93KG9wdGlvbnMpO1xuICB9XG5cbiAgZnVuY3Rpb24gc3VjY2VzcyAoKSB7XG4gICAgaWYgKG9wdGlvbnMuYXV0b19sb2dpbikge1xuICAgICAgcmV0dXJuIF90aGlzLmxvZ2luKG9wdGlvbnMsIGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICBpZiAoJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBmYWlsIChzdGF0dXMsIHJlc3ApIHtcbiAgICB2YXIgZXJyb3IgPSBuZXcgTG9naW5FcnJvcihzdGF0dXMsIHJlc3ApO1xuXG4gICAgLy8gd2hlbiBmYWlsZWQgd2Ugd2FudCB0aGUgcG9wdXAgY2xvc2VkIGlmIG9wZW5lZFxuICAgIGlmIChwb3B1cCAmJiAnZnVuY3Rpb24nID09PSB0eXBlb2YgcG9wdXAua2lsbCkge1xuICAgICAgcG9wdXAua2lsbCgpO1xuICAgIH1cblxuICAgIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgfVxuXG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICB2YXIgcHJvdG9jb2wgPSAnaHR0cHM6JztcbiAgdmFyIGRvbWFpbiA9IHRoaXMuX2RvbWFpbjtcbiAgdmFyIGVuZHBvaW50ID0gJy9kYmNvbm5lY3Rpb25zL3NpZ251cCc7XG4gIHZhciB1cmwgPSBqb2luVXJsKHByb3RvY29sLCBkb21haW4sIGVuZHBvaW50KTtcblxuICBpZiAodGhpcy5fdXNlSlNPTlApIHtcbiAgICByZXR1cm4ganNvbnAodXJsICsgJz8nICsgcXMuc3RyaW5naWZ5KHF1ZXJ5KSwganNvbnBPcHRzLCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIHJldHVybiBmYWlsKDAsIGVycik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNwLnN0YXR1cyA9PSAyMDAgPyBzdWNjZXNzKCkgOlxuICAgICAgICAgICAgICBmYWlsKHJlc3Auc3RhdHVzLCByZXNwLmVyciB8fCByZXNwLmVycm9yKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlcXdlc3Qoe1xuICAgIHVybDogICAgIHNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pID8gZW5kcG9pbnQgOiB1cmwsXG4gICAgbWV0aG9kOiAgJ3Bvc3QnLFxuICAgIHR5cGU6ICAgICdodG1sJyxcbiAgICBkYXRhOiAgICBxdWVyeSxcbiAgICBzdWNjZXNzOiBzdWNjZXNzLFxuICAgIGNyb3NzT3JpZ2luOiAhc2FtZV9vcmlnaW4ocHJvdG9jb2wsIGRvbWFpbiksXG4gICAgZXJyb3I6IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGZhaWwoZXJyLnN0YXR1cywgZXJyLnJlc3BvbnNlVGV4dCk7XG4gICAgfVxuICB9KTtcbn07XG5cbi8qKlxuICogQ2hhbmdlIHBhc3N3b3JkXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrXG4gKiBAbWV0aG9kIGNoYW5nZVBhc3N3b3JkXG4gKi9cblxuQXV0aDAucHJvdG90eXBlLmNoYW5nZVBhc3N3b3JkID0gZnVuY3Rpb24gKG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIHZhciBxdWVyeSA9IHtcbiAgICB0ZW5hbnQ6ICAgICAgICAgdGhpcy5fZG9tYWluLnNwbGl0KCcuJylbMF0sXG4gICAgY2xpZW50X2lkOiAgICAgIHRoaXMuX2NsaWVudElELFxuICAgIGNvbm5lY3Rpb246ICAgICBvcHRpb25zLmNvbm5lY3Rpb24sXG4gICAgdXNlcm5hbWU6ICAgICAgIHRyaW0ob3B0aW9ucy51c2VybmFtZSB8fCAnJyksXG4gICAgZW1haWw6ICAgICAgICAgIHRyaW0ob3B0aW9ucy5lbWFpbCB8fCBvcHRpb25zLnVzZXJuYW1lIHx8ICcnKSxcbiAgICBwYXNzd29yZDogICAgICAgb3B0aW9ucy5wYXNzd29yZFxuICB9O1xuXG5cbiAgZnVuY3Rpb24gZmFpbCAoc3RhdHVzLCByZXNwKSB7XG4gICAgdmFyIGVycm9yID0gbmV3IExvZ2luRXJyb3Ioc3RhdHVzLCByZXNwKTtcbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgdmFyIHByb3RvY29sID0gJ2h0dHBzOic7XG4gIHZhciBkb21haW4gPSB0aGlzLl9kb21haW47XG4gIHZhciBlbmRwb2ludCA9ICcvZGJjb25uZWN0aW9ucy9jaGFuZ2VfcGFzc3dvcmQnO1xuICB2YXIgdXJsID0gam9pblVybChwcm90b2NvbCwgZG9tYWluLCBlbmRwb2ludCk7XG5cbiAgaWYgKHRoaXMuX3VzZUpTT05QKSB7XG4gICAgcmV0dXJuIGpzb25wKHVybCArICc/JyArIHFzLnN0cmluZ2lmeShxdWVyeSksIGpzb25wT3B0cywgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gZmFpbCgwLCBlcnIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3Auc3RhdHVzID09IDIwMCA/XG4gICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3AubWVzc2FnZSkgOlxuICAgICAgICAgICAgICBmYWlsKHJlc3Auc3RhdHVzLCByZXNwLmVyciB8fCByZXNwLmVycm9yKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlcXdlc3Qoe1xuICAgIHVybDogICAgIHNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pID8gZW5kcG9pbnQgOiB1cmwsXG4gICAgbWV0aG9kOiAgJ3Bvc3QnLFxuICAgIHR5cGU6ICAgICdodG1sJyxcbiAgICBkYXRhOiAgICBxdWVyeSxcbiAgICBjcm9zc09yaWdpbjogIXNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pLFxuICAgIGVycm9yOiBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICBmYWlsKGVyci5zdGF0dXMsIGVyci5yZXNwb25zZVRleHQpO1xuICAgIH0sXG4gICAgc3VjY2VzczogZnVuY3Rpb24gKHIpIHtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHIpO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIEJ1aWxkcyBxdWVyeSBzdHJpbmcgdG8gYmUgcGFzc2VkIHRvIC9hdXRob3JpemUgYmFzZWQgb24gZGljdCBrZXkgYW5kIHZhbHVlcy5cbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBhcmdzXG4gKiBAcGFyYW0ge0FycmF5fSBibGFja2xpc3RcbiAqIEBwcml2YXRlXG4gKi9cblxuQXV0aDAucHJvdG90eXBlLl9idWlsZEF1dGhvcml6ZVF1ZXJ5U3RyaW5nID0gZnVuY3Rpb24gKGFyZ3MsIGJsYWNrbGlzdCkge1xuICB2YXIgcXVlcnkgPSB0aGlzLl9idWlsZEF1dGhvcml6YXRpb25QYXJhbWV0ZXJzKGFyZ3MsIGJsYWNrbGlzdCk7XG4gIHJldHVybiBxcy5zdHJpbmdpZnkocXVlcnkpO1xufTtcblxuLyoqXG4gKiBCdWlsZHMgcGFyYW1ldGVyIGRpY3Rpb25hcnkgdG8gYmUgcGFzc2VkIHRvIC9hdXRob3JpemUgYmFzZWQgb24gZGljdCBrZXkgYW5kIHZhbHVlcy5cbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBhcmdzXG4gKiBAcGFyYW0ge0FycmF5fSBibGFja2xpc3RcbiAqIEBwcml2YXRlXG4gKi9cblxuQXV0aDAucHJvdG90eXBlLl9idWlsZEF1dGhvcml6YXRpb25QYXJhbWV0ZXJzID0gZnVuY3Rpb24oYXJncywgYmxhY2tsaXN0KSB7XG4gIHZhciBxdWVyeSA9IHh0ZW5kLmFwcGx5KG51bGwsIGFyZ3MpO1xuXG4gIC8vIEFkZHMgb2ZmbGluZSBtb2RlIHRvIHRoZSBxdWVyeVxuICB0aGlzLl9jb25maWd1cmVPZmZsaW5lTW9kZShxdWVyeSk7XG5cbiAgLy8gQWRkcyBjbGllbnQgU0RLIGluZm9ybWF0aW9uICh3aGVuIGVuYWJsZWQpXG4gIGlmICggdGhpcy5fc2VuZENsaWVudEluZm8gKSBxdWVyeVsnYXV0aDBDbGllbnQnXSA9IHRoaXMuX2dldENsaWVudEluZm9TdHJpbmcoKTtcblxuICAvLyBFbGVtZW50cyB0byBmaWx0ZXIgZnJvbSBxdWVyeSBzdHJpbmdcbiAgYmxhY2tsaXN0ID0gYmxhY2tsaXN0IHx8IFsncG9wdXAnLCAncG9wdXBPcHRpb25zJ107XG5cbiAgdmFyIGksIGtleTtcblxuICBmb3IgKGkgPSAwOyBpIDwgYmxhY2tsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAga2V5ID0gYmxhY2tsaXN0W2ldO1xuICAgIGRlbGV0ZSBxdWVyeVtrZXldO1xuICB9XG5cbiAgaWYgKHF1ZXJ5LmNvbm5lY3Rpb25fc2NvcGUgJiYgaXNfYXJyYXkocXVlcnkuY29ubmVjdGlvbl9zY29wZSkpe1xuICAgIHF1ZXJ5LmNvbm5lY3Rpb25fc2NvcGUgPSBxdWVyeS5jb25uZWN0aW9uX3Njb3BlLmpvaW4oJywnKTtcbiAgfVxuXG4gIHJldHVybiBxdWVyeTtcbn07XG5cbi8qKlxuICogTG9naW4gdXNlclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQG1ldGhvZCBsb2dpblxuICovXG5cbkF1dGgwLnByb3RvdHlwZS5sb2dpbiA9IEF1dGgwLnByb3RvdHlwZS5zaWduaW4gPSBmdW5jdGlvbiAob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgLy8gVE9ETyBDaGFuZ2UgdGhpcyB0byBhIHByb3BlcnR5IG5hbWVkICdkaXNhYmxlU1NPJyBmb3IgY29uc2lzdGVuY3kuXG4gIC8vIEJ5IGRlZmF1bHQsIG9wdGlvbnMuc3NvIGlzIHRydWVcbiAgaWYgKCFjaGVja0lmU2V0KG9wdGlvbnMsICdzc28nKSkge1xuICAgIG9wdGlvbnMuc3NvID0gdHJ1ZTtcbiAgfVxuXG4gIGlmICh0eXBlb2Ygb3B0aW9ucy5wYXNzY29kZSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm4gdGhpcy5sb2dpbldpdGhQYXNzY29kZShvcHRpb25zLCBjYWxsYmFjayk7XG4gIH1cblxuICBpZiAodHlwZW9mIG9wdGlvbnMudXNlcm5hbWUgIT09ICd1bmRlZmluZWQnIHx8XG4gICAgICB0eXBlb2Ygb3B0aW9ucy5lbWFpbCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm4gdGhpcy5sb2dpbldpdGhVc2VybmFtZVBhc3N3b3JkKG9wdGlvbnMsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIGlmICghIXdpbmRvdy5jb3Jkb3ZhKSB7XG4gICAgcmV0dXJuIHRoaXMubG9naW5QaG9uZWdhcChvcHRpb25zLCBjYWxsYmFjayk7XG4gIH1cblxuICBpZiAoISFvcHRpb25zLnBvcHVwICYmIHRoaXMuX2dldENhbGxiYWNrT25Mb2NhdGlvbkhhc2gob3B0aW9ucykpIHtcbiAgICByZXR1cm4gdGhpcy5sb2dpbldpdGhQb3B1cChvcHRpb25zLCBjYWxsYmFjayk7XG4gIH1cblxuICB0aGlzLl9hdXRob3JpemUob3B0aW9ucyk7XG59O1xuXG5BdXRoMC5wcm90b3R5cGUuX2F1dGhvcml6ZSA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgdmFyIHFzID0gW1xuICAgIHRoaXMuX2dldE1vZGUob3B0aW9ucyksXG4gICAgb3B0aW9ucyxcbiAgICB7XG4gICAgICBjbGllbnRfaWQ6IHRoaXMuX2NsaWVudElELFxuICAgICAgcmVkaXJlY3RfdXJpOiB0aGlzLl9nZXRDYWxsYmFja1VSTChvcHRpb25zKVxuICAgIH1cbiAgXTtcblxuICB2YXIgcXVlcnkgPSB0aGlzLl9idWlsZEF1dGhvcml6ZVF1ZXJ5U3RyaW5nKHFzKTtcblxuICB2YXIgdXJsID0gam9pblVybCgnaHR0cHM6JywgdGhpcy5fZG9tYWluLCAnL2F1dGhvcml6ZT8nICsgcXVlcnkpO1xuXG4gIGlmIChvcHRpb25zLnBvcHVwKSB7XG4gICAgdGhpcy5fYnVpbGRQb3B1cFdpbmRvdyhvcHRpb25zLCB1cmwpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuX3JlZGlyZWN0KHVybCk7XG4gIH1cbn07XG5cbi8qKlxuICogQ29tcHV0ZSBgb3B0aW9ucy53aWR0aGAgYW5kIGBvcHRpb25zLmhlaWdodGAgZm9yIHRoZSBwb3B1cCB0b1xuICogb3BlbiBhbmQgcmV0dXJuIGFuZCBleHRlbmRlZCBvYmplY3Qgd2l0aCBvcHRpbWFsIGB0b3BgIGFuZCBgbGVmdGBcbiAqIHBvc2l0aW9uIGFyZ3VtZW50cyBmb3IgdGhlIHBvcHVwIHdpbmRvd3NcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQHByaXZhdGVcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuX2NvbXB1dGVQb3B1cFBvc2l0aW9uID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIHZhciB3aWR0aCA9IG9wdGlvbnMud2lkdGggfHwgNTAwO1xuICB2YXIgaGVpZ2h0ID0gb3B0aW9ucy5oZWlnaHQgfHwgNjAwO1xuXG4gIHZhciBzY3JlZW5YID0gdHlwZW9mIHdpbmRvdy5zY3JlZW5YICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdy5zY3JlZW5YIDogd2luZG93LnNjcmVlbkxlZnQ7XG4gIHZhciBzY3JlZW5ZID0gdHlwZW9mIHdpbmRvdy5zY3JlZW5ZICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdy5zY3JlZW5ZIDogd2luZG93LnNjcmVlblRvcDtcbiAgdmFyIG91dGVyV2lkdGggPSB0eXBlb2Ygd2luZG93Lm91dGVyV2lkdGggIT09ICd1bmRlZmluZWQnID8gd2luZG93Lm91dGVyV2lkdGggOiBkb2N1bWVudC5ib2R5LmNsaWVudFdpZHRoO1xuICB2YXIgb3V0ZXJIZWlnaHQgPSB0eXBlb2Ygd2luZG93Lm91dGVySGVpZ2h0ICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdy5vdXRlckhlaWdodCA6IChkb2N1bWVudC5ib2R5LmNsaWVudEhlaWdodCAtIDIyKTtcbiAgLy8gWFhYOiB3aGF0IGlzIHRoZSAyMj9cblxuICAvLyBVc2UgYG91dGVyV2lkdGggLSB3aWR0aGAgYW5kIGBvdXRlckhlaWdodCAtIGhlaWdodGAgZm9yIGhlbHAgaW5cbiAgLy8gcG9zaXRpb25pbmcgdGhlIHBvcHVwIGNlbnRlcmVkIHJlbGF0aXZlIHRvIHRoZSBjdXJyZW50IHdpbmRvd1xuICB2YXIgbGVmdCA9IHNjcmVlblggKyAob3V0ZXJXaWR0aCAtIHdpZHRoKSAvIDI7XG4gIHZhciB0b3AgPSBzY3JlZW5ZICsgKG91dGVySGVpZ2h0IC0gaGVpZ2h0KSAvIDI7XG5cbiAgcmV0dXJuIHsgd2lkdGg6IHdpZHRoLCBoZWlnaHQ6IGhlaWdodCwgbGVmdDogbGVmdCwgdG9wOiB0b3AgfTtcbn07XG5cbi8qKlxuICogbG9naW5QaG9uZWdhcCBtZXRob2QgaXMgdHJpZ2dlcmVkIHdoZW4gISF3aW5kb3cuY29yZG92YSBpcyB0cnVlLlxuICpcbiAqIEBtZXRob2QgbG9naW5QaG9uZWdhcFxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7T2JqZWN0fSAgICBvcHRpb25zICAgTG9naW4gb3B0aW9ucy5cbiAqIEBwYXJhbSB7RnVuY3Rpb259ICBjYWxsYmFjayAgVG8gYmUgY2FsbGVkIGFmdGVyIGxvZ2luIGhhcHBlbmVkLiBDYWxsYmFjayBhcmd1bWVudHNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hvdWxkIGJlOlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvbiAoZXJyLCBwcm9maWxlLCBpZFRva2VuLCBhY2Nlc3NUb2tlbiwgc3RhdGUpXG4gKlxuICogQGV4YW1wbGVcbiAqICAgICAgdmFyIGF1dGgwID0gbmV3IEF1dGgwKHsgY2xpZW50SWQ6ICcuLi4nLCBkb21haW46ICcuLi4nfSk7XG4gKlxuICogICAgICBhdXRoMC5zaWduaW4oe30sIGZ1bmN0aW9uIChlcnIsIHByb2ZpbGUsIGlkVG9rZW4sIGFjY2Vzc1Rva2VuLCBzdGF0ZSkge1xuICogICAgICAgIGlmIChlcnIpIHtcbiAqICAgICAgICAgYWxlcnQoZXJyKTtcbiAqICAgICAgICAgcmV0dXJuO1xuICogICAgICAgIH1cbiAqXG4gKiAgICAgICAgYWxlcnQoJ1dlbGNvbWUgJyArIHByb2ZpbGUubmFtZSk7XG4gKiAgICAgIH0pO1xuICovXG5cbkF1dGgwLnByb3RvdHlwZS5sb2dpblBob25lZ2FwID0gZnVuY3Rpb24gKG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gIGlmICh0aGlzLl9zaG91bGRBdXRoZW50aWNhdGVXaXRoQ29yZG92YVBsdWdpbihvcHRpb25zLmNvbm5lY3Rpb24pKSB7XG4gICAgdGhpcy5fc29jaWFsUGhvbmVnYXBMb2dpbihvcHRpb25zLCBjYWxsYmFjayk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIG1vYmlsZUNhbGxiYWNrVVJMID0gam9pblVybCgnaHR0cHM6JywgdGhpcy5fZG9tYWluLCAnL21vYmlsZScpO1xuICB2YXIgX3RoaXMgPSB0aGlzO1xuICB2YXIgcXMgPSBbXG4gICAgdGhpcy5fZ2V0TW9kZShvcHRpb25zKSxcbiAgICBvcHRpb25zLFxuICAgIHtcbiAgICAgIGNsaWVudF9pZDogdGhpcy5fY2xpZW50SUQsXG4gICAgICByZWRpcmVjdF91cmk6IG1vYmlsZUNhbGxiYWNrVVJMXG4gICAgfVxuICBdO1xuXG4gIGlmICggdGhpcy5fc2VuZENsaWVudEluZm8gKSB7XG4gICAgcXMucHVzaCh7IGF1dGgwQ2xpZW50OiB0aGlzLl9nZXRDbGllbnRJbmZvU3RyaW5nKCkgfSk7XG4gIH1cblxuICB2YXIgcXVlcnkgPSB0aGlzLl9idWlsZEF1dGhvcml6ZVF1ZXJ5U3RyaW5nKHFzKTtcblxuICB2YXIgcG9wdXBVcmwgPSBqb2luVXJsKCdodHRwczonLCB0aGlzLl9kb21haW4sICcvYXV0aG9yaXplPycgKyBxdWVyeSk7XG5cbiAgdmFyIHBvcHVwT3B0aW9ucyA9IHh0ZW5kKHtsb2NhdGlvbjogJ3llcyd9ICxcbiAgICBvcHRpb25zLnBvcHVwT3B0aW9ucyk7XG5cbiAgLy8gVGhpcyB3YXNuJ3Qgc2VuZCBiZWZvcmUgc28gd2UgZG9uJ3Qgc2VuZCBpdCBub3cgZWl0aGVyXG4gIGRlbGV0ZSBwb3B1cE9wdGlvbnMud2lkdGg7XG4gIGRlbGV0ZSBwb3B1cE9wdGlvbnMuaGVpZ2h0O1xuXG5cblxuICB2YXIgcmVmID0gd2luZG93Lm9wZW4ocG9wdXBVcmwsICdfYmxhbmsnLCBzdHJpbmdpZnlQb3B1cFNldHRpbmdzKHBvcHVwT3B0aW9ucykpO1xuICB2YXIgYW5zd2VyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBlcnJvckhhbmRsZXIoZXZlbnQpIHtcbiAgICBpZiAoYW5zd2VyZWQpIHsgcmV0dXJuOyB9XG4gICAgY2FsbGJhY2sobmV3IEVycm9yKGV2ZW50Lm1lc3NhZ2UpLCBudWxsLCBudWxsLCBudWxsLCBudWxsKTtcbiAgICBhbnN3ZXJlZCA9IHRydWU7XG4gICAgcmV0dXJuIHJlZi5jbG9zZSgpO1xuICB9XG5cbiAgZnVuY3Rpb24gc3RhcnRIYW5kbGVyKGV2ZW50KSB7XG4gICAgaWYgKGFuc3dlcmVkKSB7IHJldHVybjsgfVxuXG4gICAgaWYgKCBldmVudC51cmwgJiYgIShldmVudC51cmwuaW5kZXhPZihtb2JpbGVDYWxsYmFja1VSTCArICcjJykgPT09IDAgfHxcbiAgICAgICAgICAgICAgICAgICAgICAgZXZlbnQudXJsLmluZGV4T2YobW9iaWxlQ2FsbGJhY2tVUkwgKyAnPycpID09PSAwKSkgeyByZXR1cm47IH1cblxuICAgIHZhciByZXN1bHQgPSBfdGhpcy5wYXJzZUhhc2goZXZlbnQudXJsLnNsaWNlKG1vYmlsZUNhbGxiYWNrVVJMLmxlbmd0aCkpO1xuXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgIGNhbGxiYWNrKG5ldyBFcnJvcignRXJyb3IgcGFyc2luZyBoYXNoJyksIG51bGwsIG51bGwsIG51bGwsIG51bGwpO1xuICAgICAgYW5zd2VyZWQgPSB0cnVlO1xuICAgICAgcmV0dXJuIHJlZi5jbG9zZSgpO1xuICAgIH1cblxuICAgIGlmIChyZXN1bHQuaWRfdG9rZW4pIHtcbiAgICAgIF90aGlzLmdldFByb2ZpbGUocmVzdWx0LmlkX3Rva2VuLCBmdW5jdGlvbiAoZXJyLCBwcm9maWxlKSB7XG4gICAgICAgIGNhbGxiYWNrKGVyciwgcHJvZmlsZSwgcmVzdWx0LmlkX3Rva2VuLCByZXN1bHQuYWNjZXNzX3Rva2VuLCByZXN1bHQuc3RhdGUsIHJlc3VsdC5yZWZyZXNoX3Rva2VuKTtcbiAgICAgIH0pO1xuICAgICAgYW5zd2VyZWQgPSB0cnVlO1xuICAgICAgcmV0dXJuIHJlZi5jbG9zZSgpO1xuICAgIH1cblxuICAgIC8vIENhc2Ugd2hlcmUgd2UndmUgZm91bmQgYW4gZXJyb3JcbiAgICBjYWxsYmFjayhuZXcgRXJyb3IocmVzdWx0LmVyciB8fCByZXN1bHQuZXJyb3IgfHwgJ1NvbWV0aGluZyB3ZW50IHdyb25nJyksIG51bGwsIG51bGwsIG51bGwsIG51bGwpO1xuICAgIGFuc3dlcmVkID0gdHJ1ZTtcbiAgICByZXR1cm4gcmVmLmNsb3NlKCk7XG4gIH1cblxuICBmdW5jdGlvbiBleGl0SGFuZGxlcigpIHtcbiAgICBpZiAoYW5zd2VyZWQpIHsgcmV0dXJuOyB9XG5cbiAgICBjYWxsYmFjayhuZXcgRXJyb3IoJ0Jyb3dzZXIgd2luZG93IGNsb3NlZCcpLCBudWxsLCBudWxsLCBudWxsLCBudWxsKTtcblxuICAgIHJlZi5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2FkZXJyb3InLCBlcnJvckhhbmRsZXIpO1xuICAgIHJlZi5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2Fkc3RhcnQnLCBzdGFydEhhbmRsZXIpO1xuICAgIHJlZi5yZW1vdmVFdmVudExpc3RlbmVyKCdleGl0JywgZXhpdEhhbmRsZXIpO1xuICB9XG5cbiAgcmVmLmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWRlcnJvcicsIGVycm9ySGFuZGxlcik7XG4gIHJlZi5hZGRFdmVudExpc3RlbmVyKCdsb2Fkc3RhcnQnLCBzdGFydEhhbmRsZXIpO1xuICByZWYuYWRkRXZlbnRMaXN0ZW5lcignZXhpdCcsIGV4aXRIYW5kbGVyKTtcblxufTtcblxuLyoqXG4gKiBsb2dpbldpdGhQb3B1cCBtZXRob2QgaXMgdHJpZ2dlcmVkIHdoZW4gbG9naW4gbWV0aG9kIHJlY2VpdmVzIGEge3BvcHVwOiB0cnVlfSBpblxuICogdGhlIGxvZ2luIG9wdGlvbnMuXG4gKlxuICogQG1ldGhvZCBsb2dpbldpdGhQb3B1cFxuICogQHBhcmFtIHtPYmplY3R9ICAgb3B0aW9ucyAgICBMb2dpbiBvcHRpb25zLlxuICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2sgICBUbyBiZSBjYWxsZWQgYWZ0ZXIgbG9naW4gaGFwcGVuZWQgKHdoZXRoZXJcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzcyBvciBmYWlsdXJlKS4gVGhpcyBwYXJhbWV0ZXIgaXMgbWFuZGF0b3J5IHdoZW5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9uIGNhbGxiYWNrT25Mb2NhdGlvbkhhc2ggaXMgdHJ1dGh5IGJ1dCBzaG91bGQgbm90XG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJlIHVzZWQgd2hlbiBmYWxzeS5cbiAqIEBleGFtcGxlXG4gKiAgICAgICB2YXIgYXV0aDAgPSBuZXcgQXV0aDAoeyBjbGllbnRJZDogJy4uLicsIGRvbWFpbjogJy4uLicsIGNhbGxiYWNrT25Mb2NhdGlvbkhhc2g6IHRydWUgfSk7XG4gKlxuICogICAgICAgLy8gRXJyb3IhIE5vIGNhbGxiYWNrXG4gKiAgICAgICBhdXRoMC5sb2dpbih7cG9wdXA6IHRydWV9KTtcbiAqXG4gKiAgICAgICAvLyBPayFcbiAqICAgICAgIGF1dGgwLmxvZ2luKHtwb3B1cDogdHJ1ZX0sIGZ1bmN0aW9uICgpIHsgfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqICAgICAgIHZhciBhdXRoMCA9IG5ldyBBdXRoMCh7IGNsaWVudElkOiAnLi4uJywgZG9tYWluOiAnLi4uJ30pO1xuICpcbiAqICAgICAgIC8vIE9rIVxuICogICAgICAgYXV0aDAubG9naW4oe3BvcHVwOiB0cnVlfSk7XG4gKlxuICogICAgICAgLy8gRXJyb3IhIE5vIGNhbGxiYWNrIHdpbGwgYmUgZXhlY3V0ZWQgb24gcmVzcG9uc2VfdHlwZT1jb2RlXG4gKiAgICAgICBhdXRoMC5sb2dpbih7cG9wdXA6IHRydWV9LCBmdW5jdGlvbiAoKSB7IH0pO1xuICogQHByaXZhdGVcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUubG9naW5XaXRoUG9wdXAgPSBmdW5jdGlvbihvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgX3RoaXMgPSB0aGlzO1xuXG4gIGlmICghY2FsbGJhY2spIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3BvcHVwIG1vZGUgc2hvdWxkIHJlY2VpdmUgYSBtYW5kYXRvcnkgY2FsbGJhY2snKTtcbiAgfVxuXG4gIHZhciBxcyA9IFt0aGlzLl9nZXRNb2RlKG9wdGlvbnMpLCBvcHRpb25zLCB7IGNsaWVudF9pZDogdGhpcy5fY2xpZW50SUQsIG93cDogdHJ1ZSB9XTtcblxuICBpZiAodGhpcy5fc2VuZENsaWVudEluZm8pIHtcbiAgICBxcy5wdXNoKHsgYXV0aDBDbGllbnQ6IHRoaXMuX2dldENsaWVudEluZm9TdHJpbmcoKSB9KTtcbiAgfVxuXG4gIHZhciBxdWVyeSA9IHRoaXMuX2J1aWxkQXV0aG9yaXplUXVlcnlTdHJpbmcocXMpO1xuICB2YXIgcG9wdXBVcmwgPSBqb2luVXJsKCdodHRwczonLCB0aGlzLl9kb21haW4sICcvYXV0aG9yaXplPycgKyBxdWVyeSk7XG5cbiAgdmFyIHBvcHVwUG9zaXRpb24gPSB0aGlzLl9jb21wdXRlUG9wdXBQb3NpdGlvbihvcHRpb25zLnBvcHVwT3B0aW9ucyk7XG4gIHZhciBwb3B1cE9wdGlvbnMgPSB4dGVuZChwb3B1cFBvc2l0aW9uLCBvcHRpb25zLnBvcHVwT3B0aW9ucyk7XG5cbiAgdmFyIHBvcHVwID0gV2luQ2hhbi5vcGVuKHtcbiAgICB1cmw6IHBvcHVwVXJsLFxuICAgIHJlbGF5X3VybDogJ2h0dHBzOi8vJyArIHRoaXMuX2RvbWFpbiArICcvcmVsYXkuaHRtbCcsXG4gICAgd2luZG93X2ZlYXR1cmVzOiBzdHJpbmdpZnlQb3B1cFNldHRpbmdzKHBvcHVwT3B0aW9ucylcbiAgfSwgZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgLy8gRWxpbWluYXRlIGBfY3VycmVudF9wb3B1cGAgcmVmZXJlbmNlIG1hbnVhbGx5IGJlY2F1c2VcbiAgICAvLyBXaW5jaGFuIHJlbW92ZXMgYC5raWxsKClgIG1ldGhvZCBmcm9tIHdpbmRvdyBhbmQgYWxzb1xuICAgIC8vIGRvZXNuJ3QgY2FsbCBgLmtpbGwoKWAgYnkgaXRzZWxmXG4gICAgX3RoaXMuX2N1cnJlbnRfcG9wdXAgPSBudWxsO1xuXG4gICAgLy8gV2luY2hhbiBhbHdheXMgcmV0dXJucyBzdHJpbmcgZXJyb3JzLCB3ZSB3cmFwIHRoZW0gaW5zaWRlIEVycm9yIG9iamVjdHNcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sobmV3IExvZ2luRXJyb3IoZXJyKSwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGVkZ2UgY2FzZSB3aXRoIGdlbmVyaWMgZXJyb3JcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBMb2dpbkVycm9yKCdTb21ldGhpbmcgd2VudCB3cm9uZycpLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsKTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgcHJvZmlsZSByZXRyaWV2YWwgZnJvbSBpZF90b2tlbiBhbmQgcmVzcG9uZFxuICAgIGlmIChyZXN1bHQuaWRfdG9rZW4pIHtcbiAgICAgIHJldHVybiBfdGhpcy5nZXRQcm9maWxlKHJlc3VsdC5pZF90b2tlbiwgZnVuY3Rpb24gKGVyciwgcHJvZmlsZSkge1xuICAgICAgICBjYWxsYmFjayhlcnIsIHByb2ZpbGUsIHJlc3VsdC5pZF90b2tlbiwgcmVzdWx0LmFjY2Vzc190b2tlbiwgcmVzdWx0LnN0YXRlLCByZXN1bHQucmVmcmVzaF90b2tlbik7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDYXNlIHdoZXJlIHRoZSBlcnJvciBpcyByZXR1cm5lZCBhdCBhbiBgZXJyYCBwcm9wZXJ0eSBmcm9tIHRoZSByZXN1bHRcbiAgICBpZiAocmVzdWx0LmVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBMb2dpbkVycm9yKHJlc3VsdC5lcnIuc3RhdHVzLCByZXN1bHQuZXJyLmRldGFpbHMgfHwgcmVzdWx0LmVyciksIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwpO1xuICAgIH1cblxuICAgIC8vIENhc2UgZm9yIHNzb19kYmNvbm5lY3Rpb25fcG9wdXAgcmV0dXJuaW5nIGVycm9yIGF0IHJlc3VsdC5lcnJvciBpbnN0ZWFkIG9mIHJlc3VsdC5lcnJcbiAgICBpZiAocmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sobmV3IExvZ2luRXJyb3IocmVzdWx0LnN0YXR1cywgcmVzdWx0LmRldGFpbHMgfHwgcmVzdWx0KSwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCk7XG4gICAgfVxuXG4gICAgLy8gQ2FzZSB3ZSBjb3VsZG4ndCBtYXRjaCBhbnkgZXJyb3IsIHdlIHJldHVybiBhIGdlbmVyaWMgb25lXG4gICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBMb2dpbkVycm9yKCdTb21ldGhpbmcgd2VudCB3cm9uZycpLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsKTtcbiAgfSk7XG5cbiAgcG9wdXAuZm9jdXMoKTtcbn07XG5cbi8qKlxuICogX3Nob3VsZEF1dGhlbnRpY2F0ZVdpdGhDb3Jkb3ZhUGx1Z2luIG1ldGhvZCBjaGVja3Mgd2hldGhlciBBdXRoMCBpcyBwcm9wZXJseSBjb25maWd1cmVkIHRvXG4gKiBoYW5kbGUgYXV0aGVudGljYXRpb24gb2YgYSBzb2NpYWwgY29ubm5lY3Rpb24gdXNpbmcgYSBwaG9uZWdhcCBwbHVnaW4uXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9ICAgY29ubmVjdGlvbiAgICBOYW1lIG9mIHRoZSBjb25uZWN0aW9uLlxuICogQHByaXZhdGVcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuX3Nob3VsZEF1dGhlbnRpY2F0ZVdpdGhDb3Jkb3ZhUGx1Z2luID0gZnVuY3Rpb24oY29ubmVjdGlvbikge1xuICB2YXIgc29jaWFsUGx1Z2luID0gdGhpcy5fY29yZG92YVNvY2lhbFBsdWdpbnNbY29ubmVjdGlvbl07XG4gIHJldHVybiB0aGlzLl91c2VDb3Jkb3ZhU29jaWFsUGx1Z2lucyAmJiAhIXNvY2lhbFBsdWdpbjtcbn07XG5cbi8qKlxuICogX3NvY2lhbFBob25lZ2FwTG9naW4gcGVyZm9ybXMgc29jaWFsIGF1dGhlbnRpY2F0aW9uIHVzaW5nIGEgcGhvbmVnYXAgcGx1Z2luXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9ICAgY29ubmVjdGlvbiAgIE5hbWUgb2YgdGhlIGNvbm5lY3Rpb24uXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAgICAgVG8gYmUgY2FsbGVkIGFmdGVyIGxvZ2luIGhhcHBlbmVkICh3aGV0aGVyXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2VzcyBvciBmYWlsdXJlKS5cbiAqIEBwcml2YXRlXG4gKi9cblxuQXV0aDAucHJvdG90eXBlLl9zb2NpYWxQaG9uZWdhcExvZ2luID0gZnVuY3Rpb24ob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIHNvY2lhbEF1dGhlbnRpY2F0aW9uID0gdGhpcy5fY29yZG92YVNvY2lhbFBsdWdpbnNbb3B0aW9ucy5jb25uZWN0aW9uXTtcbiAgdmFyIF90aGlzID0gdGhpcztcbiAgc29jaWFsQXV0aGVudGljYXRpb24ob3B0aW9ucy5jb25uZWN0aW9uX3Njb3BlLCBmdW5jdGlvbihlcnJvciwgYWNjZXNzVG9rZW4sIGV4dHJhcykge1xuICAgIGlmIChlcnJvcikge1xuICAgICAgY2FsbGJhY2soZXJyb3IsIG51bGwsIG51bGwsIG51bGwsIG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgbG9naW5PcHRpb25zID0geHRlbmQoeyBhY2Nlc3NfdG9rZW46IGFjY2Vzc1Rva2VuIH0sIG9wdGlvbnMsIGV4dHJhcyk7XG4gICAgX3RoaXMubG9naW5XaXRoU29jaWFsQWNjZXNzVG9rZW4obG9naW5PcHRpb25zLCBjYWxsYmFjayk7XG4gIH0pO1xufTtcblxuLyoqXG4gKiBfcGhvbmVnYXBGYWNlYm9va0xvZ2luIHBlcmZvcm1zIHNvY2lhbCBhdXRoZW50aWNhdGlvbiB3aXRoIEZhY2Vib29rIHVzaW5nIHBob25lZ2FwLWZhY2Vib29rLXBsdWdpblxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSAgIHNjb3BlcyAgICAgRkIgc2NvcGVzIHVzZWQgdG8gbG9naW4uIEl0IGNhbiBiZSBhbiBBcnJheSBvZiBTdHJpbmcgb3IgYSBzaW5nbGUgU3RyaW5nLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBCeSBkZWZhdWx0IGlzIFtcInB1YmxpY19wcm9maWxlXCJdXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayAgIFRvIGJlIGNhbGxlZCBhZnRlciBsb2dpbiBoYXBwZW5lZCAod2hldGhlciBzdWNjZXNzIG9yIGZhaWx1cmUpLiBJdCB3aWxsXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHlpZWxkIHRoZSBhY2Nlc3NUb2tlbiBhbmQgYW55IGV4dHJhIGluZm9ybWF0aW9uIG5lZWVkZWQgYnkgQXV0aDAgQVBJXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yIGFuIEVycm9yIGlmIHRoZSBhdXRoZW50aWNhdGlvbiBmYWlscy4gQ2FsbGJhY2sgc2hvdWxkIGJlOlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5jdGlvbiAoZXJyLCBhY2Nlc3NUb2tlbiwgZXh0cmFzKSB7IH1cbiAqIEBwcml2YXRlXG4gKi9cblxuQXV0aDAucHJvdG90eXBlLl9waG9uZWdhcEZhY2Vib29rTG9naW4gPSBmdW5jdGlvbihzY29wZXMsIGNhbGxiYWNrKSB7XG4gIGlmICghd2luZG93LmZhY2Vib29rQ29ubmVjdFBsdWdpbiB8fCAhd2luZG93LmZhY2Vib29rQ29ubmVjdFBsdWdpbi5sb2dpbikge1xuICAgIGNhbGxiYWNrKG5ldyBFcnJvcignbWlzc2luZyBwbHVnaW4gcGhvbmVnYXAtZmFjZWJvb2stcGx1Z2luJyksIG51bGwsIG51bGwpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciBmYlNjb3BlcztcbiAgaWYgKHNjb3BlcyAmJiBpc19hcnJheShzY29wZXMpKXtcbiAgICBmYlNjb3BlcyA9IHNjb3BlcztcbiAgfSBlbHNlIGlmIChzY29wZXMpIHtcbiAgICBmYlNjb3BlcyA9IFtzY29wZXNdO1xuICB9IGVsc2Uge1xuICAgIGZiU2NvcGVzID0gWydwdWJsaWNfcHJvZmlsZSddO1xuICB9XG4gIHdpbmRvdy5mYWNlYm9va0Nvbm5lY3RQbHVnaW4ubG9naW4oZmJTY29wZXMsIGZ1bmN0aW9uIChzdGF0ZSkge1xuICAgIGNhbGxiYWNrKG51bGwsIHN0YXRlLmF1dGhSZXNwb25zZS5hY2Nlc3NUb2tlbiwge30pO1xuICB9LCBmdW5jdGlvbihlcnJvcikge1xuICAgIGNhbGxiYWNrKG5ldyBFcnJvcihlcnJvciksIG51bGwsIG51bGwpO1xuICB9KTtcbn07XG5cbi8qKlxuICogVGhpcyBtZXRob2QgaGFuZGxlcyB0aGUgc2NlbmFyaW8gd2hlcmUgYSBkYiBjb25uZWN0aW9uIGlzIHVzZWQgd2l0aFxuICogcG9wdXA6IHRydWUgYW5kIHNzbzogdHJ1ZS5cbiAqXG4gKiBAcHJpdmF0ZVxuICovXG5BdXRoMC5wcm90b3R5cGUubG9naW5XaXRoVXNlcm5hbWVQYXNzd29yZEFuZFNTTyA9IGZ1bmN0aW9uIChvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgX3RoaXMgPSB0aGlzO1xuICB2YXIgcG9wdXBQb3NpdGlvbiA9IHRoaXMuX2NvbXB1dGVQb3B1cFBvc2l0aW9uKG9wdGlvbnMucG9wdXBPcHRpb25zKTtcbiAgdmFyIHBvcHVwT3B0aW9ucyA9IHh0ZW5kKHBvcHVwUG9zaXRpb24sIG9wdGlvbnMucG9wdXBPcHRpb25zKTtcblxuICB2YXIgcG9wdXAgPSBXaW5DaGFuLm9wZW4oe1xuICAgIHVybDogJ2h0dHBzOi8vJyArIHRoaXMuX2RvbWFpbiArICcvc3NvX2RiY29ubmVjdGlvbl9wb3B1cC8nICsgdGhpcy5fY2xpZW50SUQsXG4gICAgcmVsYXlfdXJsOiAnaHR0cHM6Ly8nICsgdGhpcy5fZG9tYWluICsgJy9yZWxheS5odG1sJyxcbiAgICB3aW5kb3dfZmVhdHVyZXM6IHN0cmluZ2lmeVBvcHVwU2V0dGluZ3MocG9wdXBPcHRpb25zKSxcbiAgICBwb3B1cDogdGhpcy5fY3VycmVudF9wb3B1cCxcbiAgICBwYXJhbXM6IHtcbiAgICAgIGRvbWFpbjogICAgICAgICAgICAgICAgIHRoaXMuX2RvbWFpbixcbiAgICAgIGNsaWVudElEOiAgICAgICAgICAgICAgIHRoaXMuX2NsaWVudElELFxuICAgICAgb3B0aW9uczoge1xuICAgICAgICAvLyBUT0RPIFdoYXQgaGFwcGVucyB3aXRoIGkxOG4/XG4gICAgICAgIHVzZXJuYW1lOiAgIG9wdGlvbnMudXNlcm5hbWUsXG4gICAgICAgIHBhc3N3b3JkOiAgIG9wdGlvbnMucGFzc3dvcmQsXG4gICAgICAgIGNvbm5lY3Rpb246IG9wdGlvbnMuY29ubmVjdGlvbixcbiAgICAgICAgc3RhdGU6ICAgICAgb3B0aW9ucy5zdGF0ZSxcbiAgICAgICAgc2NvcGU6ICAgICAgb3B0aW9ucy5zY29wZVxuICAgICAgfVxuICAgIH1cbiAgfSwgZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgLy8gRWxpbWluYXRlIGBfY3VycmVudF9wb3B1cGAgcmVmZXJlbmNlIG1hbnVhbGx5IGJlY2F1c2VcbiAgICAvLyBXaW5jaGFuIHJlbW92ZXMgYC5raWxsKClgIG1ldGhvZCBmcm9tIHdpbmRvdyBhbmQgYWxzb1xuICAgIC8vIGRvZXNuJ3QgY2FsbCBgLmtpbGwoKWAgYnkgaXRzZWxmXG4gICAgX3RoaXMuX2N1cnJlbnRfcG9wdXAgPSBudWxsO1xuXG4gICAgLy8gV2luY2hhbiBhbHdheXMgcmV0dXJucyBzdHJpbmcgZXJyb3JzLCB3ZSB3cmFwIHRoZW0gaW5zaWRlIEVycm9yIG9iamVjdHNcbiAgICBpZiAoZXJyKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sobmV3IExvZ2luRXJyb3IoZXJyKSwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCk7XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIGVkZ2UgY2FzZSB3aXRoIGdlbmVyaWMgZXJyb3JcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBMb2dpbkVycm9yKCdTb21ldGhpbmcgd2VudCB3cm9uZycpLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsKTtcbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgcHJvZmlsZSByZXRyaWV2YWwgZnJvbSBpZF90b2tlbiBhbmQgcmVzcG9uZFxuICAgIGlmIChyZXN1bHQuaWRfdG9rZW4pIHtcbiAgICAgIHJldHVybiBfdGhpcy5nZXRQcm9maWxlKHJlc3VsdC5pZF90b2tlbiwgZnVuY3Rpb24gKGVyciwgcHJvZmlsZSkge1xuICAgICAgICBjYWxsYmFjayhlcnIsIHByb2ZpbGUsIHJlc3VsdC5pZF90b2tlbiwgcmVzdWx0LmFjY2Vzc190b2tlbiwgcmVzdWx0LnN0YXRlLCByZXN1bHQucmVmcmVzaF90b2tlbik7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDYXNlIHdoZXJlIHRoZSBlcnJvciBpcyByZXR1cm5lZCBhdCBhbiBgZXJyYCBwcm9wZXJ0eSBmcm9tIHRoZSByZXN1bHRcbiAgICBpZiAocmVzdWx0LmVycikge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBMb2dpbkVycm9yKHJlc3VsdC5lcnIuc3RhdHVzLCByZXN1bHQuZXJyLmRldGFpbHMgfHwgcmVzdWx0LmVyciksIG51bGwsIG51bGwsIG51bGwsIG51bGwsIG51bGwpO1xuICAgIH1cblxuICAgIC8vIENhc2UgZm9yIHNzb19kYmNvbm5lY3Rpb25fcG9wdXAgcmV0dXJuaW5nIGVycm9yIGF0IHJlc3VsdC5lcnJvciBpbnN0ZWFkIG9mIHJlc3VsdC5lcnJcbiAgICBpZiAocmVzdWx0LmVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2sobmV3IExvZ2luRXJyb3IocmVzdWx0LnN0YXR1cywgcmVzdWx0LmRldGFpbHMgfHwgcmVzdWx0KSwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCwgbnVsbCk7XG4gICAgfVxuXG4gICAgLy8gQ2FzZSB3ZSBjb3VsZG4ndCBtYXRjaCBhbnkgZXJyb3IsIHdlIHJldHVybiBhIGdlbmVyaWMgb25lXG4gICAgcmV0dXJuIGNhbGxiYWNrKG5ldyBMb2dpbkVycm9yKCdTb21ldGhpbmcgd2VudCB3cm9uZycpLCBudWxsLCBudWxsLCBudWxsLCBudWxsLCBudWxsKTtcbiAgfSk7XG5cbiAgcG9wdXAuZm9jdXMoKTtcbn07XG5cbi8qKlxuICogTG9naW4gd2l0aCBSZXNvdXJjZSBPd25lciAoUk8pXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrXG4gKiBAbWV0aG9kIGxvZ2luV2l0aFJlc291cmNlT3duZXJcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUubG9naW5XaXRoUmVzb3VyY2VPd25lciA9IGZ1bmN0aW9uIChvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgX3RoaXMgPSB0aGlzO1xuICB2YXIgcXVlcnkgPSB4dGVuZChcbiAgICB0aGlzLl9nZXRNb2RlKG9wdGlvbnMpLFxuICAgIG9wdGlvbnMsXG4gICAge1xuICAgICAgY2xpZW50X2lkOiAgICB0aGlzLl9jbGllbnRJRCxcbiAgICAgIHVzZXJuYW1lOiAgICAgdHJpbShvcHRpb25zLnVzZXJuYW1lIHx8IG9wdGlvbnMuZW1haWwgfHwgJycpLFxuICAgICAgZ3JhbnRfdHlwZTogICAncGFzc3dvcmQnXG4gICAgfSk7XG5cbiAgdGhpcy5fY29uZmlndXJlT2ZmbGluZU1vZGUocXVlcnkpO1xuXG4gIHZhciBwcm90b2NvbCA9ICdodHRwczonO1xuICB2YXIgZG9tYWluID0gdGhpcy5fZG9tYWluO1xuICB2YXIgZW5kcG9pbnQgPSAnL29hdXRoL3JvJztcbiAgdmFyIHVybCA9IGpvaW5VcmwocHJvdG9jb2wsIGRvbWFpbiwgZW5kcG9pbnQpO1xuXG4gIGlmICggdGhpcy5fc2VuZENsaWVudEluZm8gJiYgdGhpcy5fdXNlSlNPTlAgKSB7XG4gICAgcXVlcnlbJ2F1dGgwQ2xpZW50J10gPSB0aGlzLl9nZXRDbGllbnRJbmZvU3RyaW5nKCk7XG4gIH1cblxuICBmdW5jdGlvbiBlbnJpY2hHZXRQcm9maWxlKHJlc3AsIGNhbGxiYWNrKSB7XG4gICAgX3RoaXMuZ2V0UHJvZmlsZShyZXNwLmlkX3Rva2VuLCBmdW5jdGlvbiAoZXJyLCBwcm9maWxlKSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHByb2ZpbGUsIHJlc3AuaWRfdG9rZW4sIHJlc3AuYWNjZXNzX3Rva2VuLCByZXNwLnN0YXRlLCByZXNwLnJlZnJlc2hfdG9rZW4pO1xuICAgIH0pO1xuICB9XG5cbiAgaWYgKHRoaXMuX3VzZUpTT05QKSB7XG4gICAgcmV0dXJuIGpzb25wKHVybCArICc/JyArIHFzLnN0cmluZ2lmeShxdWVyeSksIGpzb25wT3B0cywgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgIH1cbiAgICAgIGlmKCdlcnJvcicgaW4gcmVzcCkge1xuICAgICAgICB2YXIgZXJyb3IgPSBuZXcgTG9naW5FcnJvcihyZXNwLnN0YXR1cywgcmVzcC5lcnJvcik7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnJvcik7XG4gICAgICB9XG4gICAgICBlbnJpY2hHZXRQcm9maWxlKHJlc3AsIGNhbGxiYWNrKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlcXdlc3Qoe1xuICAgIHVybDogICAgIHNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pID8gZW5kcG9pbnQgOiB1cmwsXG4gICAgbWV0aG9kOiAgJ3Bvc3QnLFxuICAgIHR5cGU6ICAgICdqc29uJyxcbiAgICBkYXRhOiAgICBxdWVyeSxcbiAgICBoZWFkZXJzOiB0aGlzLl9nZXRDbGllbnRJbmZvSGVhZGVyKCksXG4gICAgY3Jvc3NPcmlnaW46ICFzYW1lX29yaWdpbihwcm90b2NvbCwgZG9tYWluKSxcbiAgICBzdWNjZXNzOiBmdW5jdGlvbiAocmVzcCkge1xuICAgICAgZW5yaWNoR2V0UHJvZmlsZShyZXNwLCBjYWxsYmFjayk7XG4gICAgfSxcbiAgICBlcnJvcjogZnVuY3Rpb24gKGVycikge1xuICAgICAgaGFuZGxlUmVxdWVzdEVycm9yKGVyciwgY2FsbGJhY2spO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIExvZ2luIHdpdGggU29jaWFsIEFjY2VzcyBUb2tlblxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQG1ldGhvZCBsb2dpbldpdGhTb2NpYWxBY2Nlc3NUb2tlblxuICovXG5cbkF1dGgwLnByb3RvdHlwZS5sb2dpbldpdGhTb2NpYWxBY2Nlc3NUb2tlbiA9IGZ1bmN0aW9uIChvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgX3RoaXMgPSB0aGlzO1xuICB2YXIgcXVlcnkgPSB0aGlzLl9idWlsZEF1dGhvcml6YXRpb25QYXJhbWV0ZXJzKFtcbiAgICAgIHsgc2NvcGU6ICdvcGVuaWQnIH0sXG4gICAgICBvcHRpb25zLFxuICAgICAgeyBjbGllbnRfaWQ6IHRoaXMuX2NsaWVudElEIH1cbiAgICBdKTtcblxuICB2YXIgcHJvdG9jb2wgPSAnaHR0cHM6JztcbiAgdmFyIGRvbWFpbiA9IHRoaXMuX2RvbWFpbjtcbiAgdmFyIGVuZHBvaW50ID0gJy9vYXV0aC9hY2Nlc3NfdG9rZW4nO1xuICB2YXIgdXJsID0gam9pblVybChwcm90b2NvbCwgZG9tYWluLCBlbmRwb2ludCk7XG5cbiAgZnVuY3Rpb24gZW5yaWNoR2V0UHJvZmlsZShyZXNwLCBjYWxsYmFjaykge1xuICAgIF90aGlzLmdldFByb2ZpbGUocmVzcC5pZF90b2tlbiwgZnVuY3Rpb24gKGVyciwgcHJvZmlsZSkge1xuICAgICAgY2FsbGJhY2soZXJyLCBwcm9maWxlLCByZXNwLmlkX3Rva2VuLCByZXNwLmFjY2Vzc190b2tlbiwgcmVzcC5zdGF0ZSwgcmVzcC5yZWZyZXNoX3Rva2VuKTtcbiAgICB9KTtcbiAgfVxuXG4gIGlmICh0aGlzLl91c2VKU09OUCkge1xuICAgIHJldHVybiBqc29ucCh1cmwgKyAnPycgKyBxcy5zdHJpbmdpZnkocXVlcnkpLCBqc29ucE9wdHMsIGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycik7XG4gICAgICB9XG4gICAgICBpZignZXJyb3InIGluIHJlc3ApIHtcbiAgICAgICAgdmFyIGVycm9yID0gbmV3IExvZ2luRXJyb3IocmVzcC5zdGF0dXMsIHJlc3AuZXJyb3IpO1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgfVxuICAgICAgZW5yaWNoR2V0UHJvZmlsZShyZXNwLCBjYWxsYmFjayk7XG4gICAgfSk7XG4gIH1cblxuICByZXF3ZXN0KHtcbiAgICB1cmw6ICAgICBzYW1lX29yaWdpbihwcm90b2NvbCwgZG9tYWluKSA/IGVuZHBvaW50IDogdXJsLFxuICAgIG1ldGhvZDogICdwb3N0JyxcbiAgICB0eXBlOiAgICAnanNvbicsXG4gICAgZGF0YTogICAgcXVlcnksXG4gICAgaGVhZGVyczogdGhpcy5fZ2V0Q2xpZW50SW5mb0hlYWRlcigpLFxuICAgIGNyb3NzT3JpZ2luOiAhc2FtZV9vcmlnaW4ocHJvdG9jb2wsIGRvbWFpbiksXG4gICAgc3VjY2VzczogZnVuY3Rpb24gKHJlc3ApIHtcbiAgICAgIGVucmljaEdldFByb2ZpbGUocmVzcCwgY2FsbGJhY2spO1xuICAgIH0sXG4gICAgZXJyb3I6IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIGhhbmRsZVJlcXVlc3RFcnJvcihlcnIsIGNhbGxiYWNrKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBPcGVuIGEgcG9wdXAsIHN0b3JlIHRoZSB3aW5yZWYgaW4gdGhlIGluc3RhbmNlIGFuZCByZXR1cm4gaXQuXG4gKlxuICogV2UgdXN1YWxseSBuZWVkIHRvIGNhbGwgdGhpcyBtZXRob2QgYmVmb3JlIGFueSBhamF4IHRyYW5zYWN0aW9uIGluIG9yZGVyXG4gKiB0byBwcmV2ZW50IHRoZSBicm93c2VyIHRvIGJsb2NrIHRoZSBwb3B1cC5cbiAqXG4gKiBAcGFyYW0gIHtbdHlwZV19ICAgb3B0aW9ucyAgW2Rlc2NyaXB0aW9uXVxuICogQHBhcmFtICB7RnVuY3Rpb259IGNhbGxiYWNrIFtkZXNjcmlwdGlvbl1cbiAqIEByZXR1cm4ge1t0eXBlXX0gICAgICAgICAgICBbZGVzY3JpcHRpb25dXG4gKiBAcHJpdmF0ZVxuICovXG5cbkF1dGgwLnByb3RvdHlwZS5fYnVpbGRQb3B1cFdpbmRvdyA9IGZ1bmN0aW9uIChvcHRpb25zLCB1cmwpIHtcbiAgaWYgKHRoaXMuX2N1cnJlbnRfcG9wdXAgJiYgIXRoaXMuX2N1cnJlbnRfcG9wdXAuY2xvc2VkKSB7XG4gICAgcmV0dXJuIHRoaXMuX2N1cnJlbnRfcG9wdXA7XG4gIH1cblxuICB1cmwgPSB1cmwgfHwgJ2Fib3V0OmJsYW5rJ1xuXG4gIHZhciBfdGhpcyA9IHRoaXM7XG4gIHZhciBkZWZhdWx0cyA9IHsgd2lkdGg6IDUwMCwgaGVpZ2h0OiA2MDAgfTtcbiAgdmFyIG9wdHMgPSB4dGVuZChkZWZhdWx0cywgb3B0aW9ucy5wb3B1cE9wdGlvbnMgfHwge30pO1xuICB2YXIgcG9wdXBPcHRpb25zID0gc3RyaW5naWZ5UG9wdXBTZXR0aW5ncyhvcHRzKTtcblxuICB0aGlzLl9jdXJyZW50X3BvcHVwID0gd2luZG93Lm9wZW4odXJsLCAnYXV0aDBfc2lnbnVwX3BvcHVwJywgcG9wdXBPcHRpb25zKTtcblxuICBpZiAoIXRoaXMuX2N1cnJlbnRfcG9wdXApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1BvcHVwIHdpbmRvdyBjYW5ub3Qgbm90IGJlZW4gY3JlYXRlZC4gRGlzYWJsZSBwb3B1cCBibG9ja2VyIG9yIG1ha2Ugc3VyZSB0byBjYWxsIEF1dGgwIGxvZ2luIG9yIHNpbmd1cCBvbiBhbiBVSSBldmVudC4nKTtcbiAgfVxuXG4gIHRoaXMuX2N1cnJlbnRfcG9wdXAua2lsbCA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmNsb3NlKCk7XG4gICAgX3RoaXMuX2N1cnJlbnRfcG9wdXAgPSBudWxsO1xuICB9O1xuXG4gIHJldHVybiB0aGlzLl9jdXJyZW50X3BvcHVwO1xufTtcblxuLyoqXG4gKiBMb2dpbiB3aXRoIFVzZXJuYW1lIGFuZCBQYXNzd29yZFxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQG1ldGhvZCBsb2dpbldpdGhVc2VybmFtZVBhc3N3b3JkXG4gKi9cblxuQXV0aDAucHJvdG90eXBlLmxvZ2luV2l0aFVzZXJuYW1lUGFzc3dvcmQgPSBmdW5jdGlvbiAob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgLy8gWFhYOiBXYXJuaW5nOiBUaGlzIGNoZWNrIGlzIHdoZXRoZXIgY2FsbGJhY2sgYXJndW1lbnRzIGFyZVxuICAvLyBmbihlcnIpIGNhc2UgY2FsbGJhY2subGVuZ3RoID09PSAxIChhIHJlZGlyZWN0IHNob3VsZCBiZSBwZXJmb3JtZWQpIHZzLlxuICAvLyBmbihlcnIsIHByb2ZpbGUsIGlkX3Rva2VuLCBhY2Nlc3NfdG9rZW4sIHN0YXRlKSBjYWxsYmFjay5sZW5ndGggPiAxIChub1xuICAvLyByZWRpcmVjdCBzaG91bGQgYmUgcGVyZm9ybWVkKVxuICAvL1xuICAvLyBOb3RlOiBQaG9uZWdhcC9Db3Jkb3ZhOlxuICAvLyBBcyB0aGUgcG9wdXAgaXMgbGF1bmNoZWQgdXNpbmcgdGhlIEluQXBwQnJvd3NlciBwbHVnaW4gdGhlIFNTTyBjb29raWUgd2lsbFxuICAvLyBiZSBzZXQgb24gdGhlIEluQXBwQnJvd3NlciBicm93c2VyLiBUaGF0J3Mgd2h5IHRoZSBicm93c2VyIHdoZXJlIHRoZSBhcHAgcnVuc1xuICAvLyB3b24ndCBnZXQgdGhlIHNzbyBjb29raWUuIFRoZXJlZm9yZSwgd2UgZG9uJ3QgYWxsb3cgdXNlcm5hbWUgcGFzc3dvcmQgdXNpbmdcbiAgLy8gcG9wdXAgd2l0aCBzc286IHRydWUgaW4gQ29yZG92YS9QaG9uZWdhcCBhbmQgd2UgZGVmYXVsdCB0byByZXNvdXJjZSBvd25lciBhdXRoLlxuICBpZiAoY2FsbGJhY2sgJiYgY2FsbGJhY2subGVuZ3RoID4gMSAmJiAoIW9wdGlvbnMuc3NvIHx8IHdpbmRvdy5jb3Jkb3ZhKSkge1xuICAgIHJldHVybiB0aGlzLmxvZ2luV2l0aFJlc291cmNlT3duZXIob3B0aW9ucywgY2FsbGJhY2spO1xuICB9XG5cbiAgdmFyIF90aGlzID0gdGhpcztcbiAgdmFyIHBvcHVwO1xuXG4gIC8vIFRPRE8gV2Ugc2hvdWxkIGRlcHJlY2F0ZSB0aGlzLCByZWFsbHkgaGFja3kgYW5kIGNvbmZ1c2VzIHBlb3BsZS5cbiAgaWYgKG9wdGlvbnMucG9wdXAgICYmICF0aGlzLl9nZXRDYWxsYmFja09uTG9jYXRpb25IYXNoKG9wdGlvbnMpKSB7XG4gICAgcG9wdXAgPSB0aGlzLl9idWlsZFBvcHVwV2luZG93KG9wdGlvbnMpO1xuICB9XG5cbiAgLy8gV2hlbiBhIGNhbGxiYWNrIHdpdGggbW9yZSB0aGFuIG9uZSBhcmd1bWVudCBpcyBzcGVjaWZpZWQgYW5kIHNzbzogdHJ1ZSB0aGVuXG4gIC8vIHdlIG9wZW4gYSBwb3B1cCBhbmQgZG8gYXV0aGVudGljYXRpb24gdGhlcmUuXG4gIGlmIChjYWxsYmFjayAmJiBjYWxsYmFjay5sZW5ndGggPiAxICYmIG9wdGlvbnMuc3NvICkge1xuICAgIHJldHVybiB0aGlzLmxvZ2luV2l0aFVzZXJuYW1lUGFzc3dvcmRBbmRTU08ob3B0aW9ucywgY2FsbGJhY2spO1xuICB9XG5cbiAgdmFyIHF1ZXJ5ID0geHRlbmQoXG4gICAgdGhpcy5fZ2V0TW9kZShvcHRpb25zKSxcbiAgICBvcHRpb25zLFxuICAgIHtcbiAgICAgIGNsaWVudF9pZDogdGhpcy5fY2xpZW50SUQsXG4gICAgICByZWRpcmVjdF91cmk6IHRoaXMuX2dldENhbGxiYWNrVVJMKG9wdGlvbnMpLFxuICAgICAgdXNlcm5hbWU6IHRyaW0ob3B0aW9ucy51c2VybmFtZSB8fCBvcHRpb25zLmVtYWlsIHx8ICcnKSxcbiAgICAgIHRlbmFudDogdGhpcy5fZG9tYWluLnNwbGl0KCcuJylbMF1cbiAgICB9KTtcblxuICB0aGlzLl9jb25maWd1cmVPZmZsaW5lTW9kZShxdWVyeSk7XG5cbiAgdmFyIHByb3RvY29sID0gJ2h0dHBzOic7XG4gIHZhciBkb21haW4gPSB0aGlzLl9kb21haW47XG4gIHZhciBlbmRwb2ludCA9ICcvdXNlcm5hbWVwYXNzd29yZC9sb2dpbic7XG4gIHZhciB1cmwgPSBqb2luVXJsKHByb3RvY29sLCBkb21haW4sIGVuZHBvaW50KTtcblxuICBpZiAodGhpcy5fdXNlSlNPTlApIHtcbiAgICByZXR1cm4ganNvbnAodXJsICsgJz8nICsgcXMuc3RyaW5naWZ5KHF1ZXJ5KSwganNvbnBPcHRzLCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGlmIChwb3B1cCAmJiBwb3B1cC5raWxsKSB7IHBvcHVwLmtpbGwoKTsgfVxuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgIH1cbiAgICAgIGlmKCdlcnJvcicgaW4gcmVzcCkge1xuICAgICAgICBpZiAocG9wdXAgJiYgcG9wdXAua2lsbCkgeyBwb3B1cC5raWxsKCk7IH1cbiAgICAgICAgdmFyIGVycm9yID0gbmV3IExvZ2luRXJyb3IocmVzcC5zdGF0dXMsIHJlc3AuZXJyb3IpO1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgICAgfVxuICAgICAgX3RoaXMuX3JlbmRlckFuZFN1Ym1pdFdTRmVkRm9ybShvcHRpb25zLCByZXNwLmZvcm0pO1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcmV0dXJuX2Vycm9yIChlcnJvcikge1xuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICByZXF3ZXN0KHtcbiAgICB1cmw6ICAgICBzYW1lX29yaWdpbihwcm90b2NvbCwgZG9tYWluKSA/IGVuZHBvaW50IDogdXJsLFxuICAgIG1ldGhvZDogICdwb3N0JyxcbiAgICB0eXBlOiAgICAnaHRtbCcsXG4gICAgZGF0YTogICAgcXVlcnksXG4gICAgaGVhZGVyczogdGhpcy5fZ2V0Q2xpZW50SW5mb0hlYWRlcigpLFxuICAgIGNyb3NzT3JpZ2luOiAhc2FtZV9vcmlnaW4ocHJvdG9jb2wsIGRvbWFpbiksXG4gICAgc3VjY2VzczogZnVuY3Rpb24gKHJlc3ApIHtcbiAgICAgIF90aGlzLl9yZW5kZXJBbmRTdWJtaXRXU0ZlZEZvcm0ob3B0aW9ucywgcmVzcCk7XG4gICAgfSxcbiAgICBlcnJvcjogZnVuY3Rpb24gKGVycikge1xuICAgICAgaWYgKHBvcHVwICYmIHBvcHVwLmtpbGwpIHtcbiAgICAgICAgcG9wdXAua2lsbCgpO1xuICAgICAgfVxuICAgICAgaGFuZGxlUmVxdWVzdEVycm9yKGVyciwgcmV0dXJuX2Vycm9yKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBMb2dpbiB3aXRoIHBob25lIG51bWJlciBhbmQgcGFzc2NvZGVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2tcbiAqIEBtZXRob2QgbG9naW5XaXRoUGhvbmVOdW1iZXJcbiAqL1xuQXV0aDAucHJvdG90eXBlLmxvZ2luV2l0aFBhc3Njb2RlID0gZnVuY3Rpb24gKG9wdGlvbnMsIGNhbGxiYWNrKSB7XG5cbiAgaWYgKG9wdGlvbnMuZW1haWwgPT0gbnVsbCAmJiBvcHRpb25zLnBob25lTnVtYmVyID09IG51bGwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2VtYWlsIG9yIHBob25lTnVtYmVyIGlzIHJlcXVpcmVkIGZvciBhdXRoZW50aWNhdGlvbicpO1xuICB9XG5cbiAgaWYgKG9wdGlvbnMucGFzc2NvZGUgPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBFcnJvcigncGFzc2NvZGUgaXMgcmVxdWlyZWQgZm9yIGF1dGhlbnRpY2F0aW9uJyk7XG4gIH1cblxuICBvcHRpb25zLmNvbm5lY3Rpb24gPSBvcHRpb25zLmVtYWlsID09IG51bGwgPyAnc21zJyA6ICdlbWFpbCc7XG5cbiAgaWYgKCF0aGlzLl9zaG91bGRSZWRpcmVjdCkge1xuICAgIG9wdGlvbnMgPSB4dGVuZChvcHRpb25zLCB7XG4gICAgICB1c2VybmFtZTogb3B0aW9ucy5lbWFpbCA9PSBudWxsID8gb3B0aW9ucy5waG9uZU51bWJlciA6IG9wdGlvbnMuZW1haWwsXG4gICAgICBwYXNzd29yZDogb3B0aW9ucy5wYXNzY29kZSxcbiAgICAgIHNzbzogZmFsc2VcbiAgICB9KTtcblxuICAgIGRlbGV0ZSBvcHRpb25zLmVtYWlsO1xuICAgIGRlbGV0ZSBvcHRpb25zLnBob25lTnVtYmVyO1xuICAgIGRlbGV0ZSBvcHRpb25zLnBhc3Njb2RlO1xuXG4gICAgcmV0dXJuIHRoaXMubG9naW5XaXRoUmVzb3VyY2VPd25lcihvcHRpb25zLCBjYWxsYmFjayk7XG4gIH1cblxuICB2YXIgdmVyaWZ5T3B0aW9ucyA9IHtjb25uZWN0aW9uOiBvcHRpb25zLmNvbm5lY3Rpb259O1xuXG4gIGlmIChvcHRpb25zLnBob25lTnVtYmVyKSB7XG4gICAgb3B0aW9ucy5waG9uZV9udW1iZXIgPSBvcHRpb25zLnBob25lTnVtYmVyO1xuICAgIGRlbGV0ZSBvcHRpb25zLnBob25lTnVtYmVyO1xuXG4gICAgdmVyaWZ5T3B0aW9ucy5waG9uZV9udW1iZXIgPSBvcHRpb25zLnBob25lX251bWJlcjtcbiAgfVxuXG4gIGlmIChvcHRpb25zLmVtYWlsKSB7XG4gICAgdmVyaWZ5T3B0aW9ucy5lbWFpbCA9IG9wdGlvbnMuZW1haWw7XG4gIH1cblxuICBvcHRpb25zLnZlcmlmaWNhdGlvbl9jb2RlID0gb3B0aW9ucy5wYXNzY29kZTtcbiAgZGVsZXRlIG9wdGlvbnMucGFzc2NvZGU7XG5cbiAgdmVyaWZ5T3B0aW9ucy52ZXJpZmljYXRpb25fY29kZSA9IG9wdGlvbnMudmVyaWZpY2F0aW9uX2NvZGU7XG5cbiAgdmFyIF90aGlzID0gdGhpcztcbiAgdGhpcy5fdmVyaWZ5KHZlcmlmeU9wdGlvbnMsIGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgaWYgKGVycm9yKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgICBfdGhpcy5fdmVyaWZ5X3JlZGlyZWN0KG9wdGlvbnMpO1xuICB9KTtcbn07XG5cbkF1dGgwLnByb3RvdHlwZS5fdmVyaWZ5ID0gZnVuY3Rpb24ob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIHByb3RvY29sID0gJ2h0dHBzOic7XG4gIHZhciBkb21haW4gPSB0aGlzLl9kb21haW47XG4gIHZhciBlbmRwb2ludCA9ICcvcGFzc3dvcmRsZXNzL3ZlcmlmeSc7XG4gIHZhciB1cmwgPSBqb2luVXJsKHByb3RvY29sLCBkb21haW4sIGVuZHBvaW50KTtcblxuICB2YXIgZGF0YSA9IG9wdGlvbnM7XG5cbiAgaWYgKHRoaXMuX3VzZUpTT05QKSB7XG4gICAgaWYgKHRoaXMuX3NlbmRDbGllbnRJbmZvKSB7XG4gICAgICBkYXRhWydhdXRoMENsaWVudCddID0gdGhpcy5fZ2V0Q2xpZW50SW5mb1N0cmluZygpO1xuICAgIH1cblxuICAgIHJldHVybiBqc29ucCh1cmwgKyAnPycgKyBxcy5zdHJpbmdpZnkoZGF0YSksIGpzb25wT3B0cywgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sobmV3IEVycm9yKDAgKyAnOiAnICsgZXJyLnRvU3RyaW5nKCkpKTtcbiAgICAgIH1cbiAgICAgIC8vIC8qKi8gdHlwZW9mIF9fYXV0aDBqcDAgPT09ICdmdW5jdGlvbicgJiYgX19hdXRoMGpwMCh7XCJzdGF0dXNcIjo0MDB9KTtcbiAgICAgIHJldHVybiByZXNwLnN0YXR1cyA9PT0gMjAwID8gY2FsbGJhY2sobnVsbCwgdHJ1ZSkgOiBjYWxsYmFjayh7c3RhdHVzOiByZXNwLnN0YXR1c30pO1xuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHJlcXdlc3Qoe1xuICAgIHVybDogICAgICAgICAgc2FtZV9vcmlnaW4ocHJvdG9jb2wsIGRvbWFpbikgPyBlbmRwb2ludCA6IHVybCxcbiAgICBtZXRob2Q6ICAgICAgICdwb3N0JyxcbiAgICBoZWFkZXJzOiAgICAgIHRoaXMuX2dldENsaWVudEluZm9IZWFkZXIoKSxcbiAgICBjcm9zc09yaWdpbjogICFzYW1lX29yaWdpbihwcm90b2NvbCwgZG9tYWluKSxcbiAgICBkYXRhOiAgICAgICAgIGRhdGFcbiAgfSlcbiAgLmZhaWwoZnVuY3Rpb24gKGVycikge1xuICAgIHRyeSB7XG4gICAgICBjYWxsYmFjayhKU09OLnBhcnNlKGVyci5yZXNwb25zZVRleHQpKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB2YXIgZXJyb3IgPSBuZXcgRXJyb3IoZXJyLnN0YXR1cyArICcoJyArIGVyci5zdGF0dXNUZXh0ICsgJyk6ICcgKyBlcnIucmVzcG9uc2VUZXh0KTtcbiAgICAgIGVycm9yLnN0YXR1c0NvZGUgPSBlcnIuc3RhdHVzO1xuICAgICAgZXJyb3IuZXJyb3IgPSBlcnIuc3RhdHVzVGV4dDtcbiAgICAgIGVycm9yLm1lc3NhZ2UgPSBlcnIucmVzcG9uc2VUZXh0O1xuICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgIH1cbiAgfSlcbiAgLnRoZW4oZnVuY3Rpb24gKHJlc3VsdCkge1xuICAgIGNhbGxiYWNrKG51bGwsIHJlc3VsdCk7XG4gIH0pO1xufVxuXG5BdXRoMC5wcm90b3R5cGUuX3ZlcmlmeV9yZWRpcmVjdCA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgdmFyIHFzID0gW1xuICAgIHRoaXMuX2dldE1vZGUob3B0aW9ucyksXG4gICAgb3B0aW9ucyxcbiAgICB7XG4gICAgICBjbGllbnRfaWQ6IHRoaXMuX2NsaWVudElELFxuICAgICAgcmVkaXJlY3RfdXJpOiB0aGlzLl9nZXRDYWxsYmFja1VSTChvcHRpb25zKVxuICAgIH1cbiAgXTtcblxuICB2YXIgcXVlcnkgPSB0aGlzLl9idWlsZEF1dGhvcml6ZVF1ZXJ5U3RyaW5nKHFzKTtcbiAgdmFyIHVybCA9IGpvaW5VcmwoJ2h0dHBzOicsIHRoaXMuX2RvbWFpbiwgJy9wYXNzd29yZGxlc3MvdmVyaWZ5X3JlZGlyZWN0PycgKyBxdWVyeSk7XG5cbiAgdGhpcy5fcmVkaXJlY3QodXJsKTtcbn07XG5cbi8vIFRPRE8gRG9jdW1lbnQgbWVcbkF1dGgwLnByb3RvdHlwZS5yZW5ld0lkVG9rZW4gPSBmdW5jdGlvbiAoaWRfdG9rZW4sIGNhbGxiYWNrKSB7XG4gIHRoaXMuZ2V0RGVsZWdhdGlvblRva2VuKHtcbiAgICBpZF90b2tlbjogaWRfdG9rZW4sXG4gICAgc2NvcGU6ICdwYXNzdGhyb3VnaCcsXG4gICAgYXBpOiAnYXV0aDAnXG4gIH0sIGNhbGxiYWNrKTtcbn07XG5cbi8vIFRPRE8gRG9jdW1lbnQgbWVcbkF1dGgwLnByb3RvdHlwZS5yZWZyZXNoVG9rZW4gPSBmdW5jdGlvbiAocmVmcmVzaF90b2tlbiwgY2FsbGJhY2spIHtcbiAgdGhpcy5nZXREZWxlZ2F0aW9uVG9rZW4oe1xuICAgIHJlZnJlc2hfdG9rZW46IHJlZnJlc2hfdG9rZW4sXG4gICAgc2NvcGU6ICdwYXNzdGhyb3VnaCcsXG4gICAgYXBpOiAnYXV0aDAnXG4gIH0sIGNhbGxiYWNrKTtcbn07XG5cbi8qKlxuICogR2V0IGRlbGVnYXRpb24gdG9rZW4gZm9yIGNlcnRhaW4gYWRkb24gb3IgY2VydGFpbiBvdGhlciBjbGllbnRJZFxuICpcbiAqIEBleGFtcGxlXG4gKlxuICogICAgIGF1dGgwLmdldERlbGVnYXRpb25Ub2tlbih7XG4gKiAgICAgIGlkX3Rva2VuOiAgICc8dXNlci1pZC10b2tlbj4nLFxuICogICAgICB0YXJnZXQ6ICAgICAnPGFwcC1jbGllbnQtaWQ+J1xuICogICAgICBhcGlfdHlwZTogJ2F1dGgwJ1xuICogICAgIH0sIGZ1bmN0aW9uIChlcnIsIGRlbGVnYXRpb25SZXN1bHQpIHtcbiAqICAgICAgICBpZiAoZXJyKSByZXR1cm4gY29uc29sZS5sb2coZXJyLm1lc3NhZ2UpO1xuICogICAgICAgIC8vIERvIHN0dWZmIHdpdGggZGVsZWdhdGlvbiB0b2tlblxuICogICAgICAgIGV4cGVjdChkZWxlZ2F0aW9uUmVzdWx0LmlkX3Rva2VuKS50by5leGlzdDtcbiAqICAgICAgICBleHBlY3QoZGVsZWdhdGlvblJlc3VsdC50b2tlbl90eXBlKS50by5lcWwoJ0JlYXJlcicpO1xuICogICAgICAgIGV4cGVjdChkZWxlZ2F0aW9uUmVzdWx0LmV4cGlyZXNfaW4pLnRvLmVxbCgzNjAwMCk7XG4gKiAgICAgfSk7XG4gKlxuICogQGV4YW1wbGVcbiAqXG4gKiAgICAgIC8vIGdldCBhIGRlbGVnYXRpb24gdG9rZW4gZnJvbSBhIEZpcmViYXNlIEFQSSBBcHBcbiAgKiAgICAgYXV0aDAuZ2V0RGVsZWdhdGlvblRva2VuKHtcbiAqICAgICAgaWRfdG9rZW46ICAgJzx1c2VyLWlkLXRva2VuPicsXG4gKiAgICAgIHRhcmdldDogICAgICc8YXBwLWNsaWVudC1pZD4nXG4gKiAgICAgIGFwaV90eXBlOiAnZmlyZWJhc2UnXG4gKiAgICAgfSwgZnVuY3Rpb24gKGVyciwgZGVsZWdhdGlvblJlc3VsdCkge1xuICogICAgICAvLyBVc2UgeW91ciBmaXJlYmFzZSB0b2tlbiBoZXJlXG4gKiAgICB9KTtcbiAqXG4gKiBAbWV0aG9kIGdldERlbGVnYXRpb25Ub2tlblxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICogQHBhcmFtIHtTdHJpbmd9IFtpZF90b2tlbl1cbiAqIEBwYXJhbSB7U3RyaW5nfSBbdGFyZ2V0XVxuICogQHBhcmFtIHtTdHJpbmd9IFthcGlfdHlwZV1cbiAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja11cbiAqL1xuQXV0aDAucHJvdG90eXBlLmdldERlbGVnYXRpb25Ub2tlbiA9IGZ1bmN0aW9uIChvcHRpb25zLCBjYWxsYmFjaykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICBpZiAoIW9wdGlvbnMuaWRfdG9rZW4gJiYgIW9wdGlvbnMucmVmcmVzaF90b2tlbiApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBtdXN0IHNlbmQgZWl0aGVyIGFuIGlkX3Rva2VuIG9yIGEgcmVmcmVzaF90b2tlbiB0byBnZXQgYSBkZWxlZ2F0aW9uIHRva2VuLicpO1xuICB9XG5cbiAgdmFyIHF1ZXJ5ID0geHRlbmQoe1xuICAgIGdyYW50X3R5cGU6ICd1cm46aWV0ZjpwYXJhbXM6b2F1dGg6Z3JhbnQtdHlwZTpqd3QtYmVhcmVyJyxcbiAgICBjbGllbnRfaWQ6ICB0aGlzLl9jbGllbnRJRCxcbiAgICB0YXJnZXQ6IG9wdGlvbnMudGFyZ2V0Q2xpZW50SWQgfHwgdGhpcy5fY2xpZW50SUQsXG4gICAgYXBpX3R5cGU6IG9wdGlvbnMuYXBpXG4gIH0sIG9wdGlvbnMpO1xuXG4gIGRlbGV0ZSBxdWVyeS5oYXNPd25Qcm9wZXJ0eTtcbiAgZGVsZXRlIHF1ZXJ5LnRhcmdldENsaWVudElkO1xuICBkZWxldGUgcXVlcnkuYXBpO1xuXG4gIHZhciBwcm90b2NvbCA9ICdodHRwczonO1xuICB2YXIgZG9tYWluID0gdGhpcy5fZG9tYWluO1xuICB2YXIgZW5kcG9pbnQgPSAnL2RlbGVnYXRpb24nO1xuICB2YXIgdXJsID0gam9pblVybChwcm90b2NvbCwgZG9tYWluLCBlbmRwb2ludCk7XG5cbiAgaWYgKHRoaXMuX3VzZUpTT05QKSB7XG4gICAgcmV0dXJuIGpzb25wKHVybCArICc/JyArIHFzLnN0cmluZ2lmeShxdWVyeSksIGpzb25wT3B0cywgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2soZXJyKTtcbiAgICAgIH1cbiAgICAgIGlmKCdlcnJvcicgaW4gcmVzcCkge1xuICAgICAgICB2YXIgZXJyb3IgPSBuZXcgTG9naW5FcnJvcihyZXNwLnN0YXR1cywgcmVzcC5lcnJvcl9kZXNjcmlwdGlvbiB8fCByZXNwLmVycm9yKTtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3ApO1xuICAgIH0pO1xuICB9XG5cbiAgcmVxd2VzdCh7XG4gICAgdXJsOiAgICAgc2FtZV9vcmlnaW4ocHJvdG9jb2wsIGRvbWFpbikgPyBlbmRwb2ludCA6IHVybCxcbiAgICBtZXRob2Q6ICAncG9zdCcsXG4gICAgdHlwZTogICAgJ2pzb24nLFxuICAgIGRhdGE6ICAgIHF1ZXJ5LFxuICAgIGNyb3NzT3JpZ2luOiAhc2FtZV9vcmlnaW4ocHJvdG9jb2wsIGRvbWFpbiksXG4gICAgc3VjY2VzczogZnVuY3Rpb24gKHJlc3ApIHtcbiAgICAgIGNhbGxiYWNrKG51bGwsIHJlc3ApO1xuICAgIH0sXG4gICAgZXJyb3I6IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNhbGxiYWNrKEpTT04ucGFyc2UoZXJyLnJlc3BvbnNlVGV4dCkpO1xuICAgICAgfVxuICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgdmFyIGVyID0gZXJyO1xuICAgICAgICB2YXIgaXNBZmZlY3RlZElFVmVyc2lvbiA9IGlzSW50ZXJuZXRFeHBsb3JlcigpID09PSAxMCB8fCBpc0ludGVybmV0RXhwbG9yZXIoKSA9PT0gMTE7XG4gICAgICAgIHZhciB6ZXJvU3RhdHVzID0gKCFlci5zdGF0dXMgfHwgZXIuc3RhdHVzID09PSAwKTtcblxuICAgICAgICAvLyBSZXF1ZXN0IGZhaWxlZCBiZWNhdXNlIHdlIGFyZSBvZmZsaW5lLlxuICAgICAgICAvLyBTZWU6IGh0dHA6Ly9jYW5pdXNlLmNvbS8jc2VhcmNoPW5hdmlnYXRvci5vbkxpbmVcbiAgICAgICAgaWYgKHplcm9TdGF0dXMgJiYgIXdpbmRvdy5uYXZpZ2F0b3Iub25MaW5lKSB7XG4gICAgICAgICAgZXIgPSB7fTtcbiAgICAgICAgICBlci5zdGF0dXMgPSAwO1xuICAgICAgICAgIGVyLnJlc3BvbnNlVGV4dCA9IHtcbiAgICAgICAgICAgIGNvZGU6ICdvZmZsaW5lJ1xuICAgICAgICAgIH07XG4gICAgICAgIC8vIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMjMyMjk3MjMvaWUtMTAtMTEtY29ycy1zdGF0dXMtMFxuICAgICAgICAvLyBYWFggSUUxMCB3aGVuIGEgcmVxdWVzdCBmYWlscyBpbiBDT1JTIHJldHVybnMgc3RhdHVzIGNvZGUgMFxuICAgICAgICAvLyBYWFggVGhpcyBpcyBub3QgaGFuZGxlZCBieSBoYW5kbGVSZXF1ZXN0RXJyb3IgYXMgdGhlIGVycm9ycyBhcmUgZGlmZmVyZW50XG4gICAgICAgIH0gZWxzZSBpZiAoemVyb1N0YXR1cyAmJiBpc0FmZmVjdGVkSUVWZXJzaW9uKSB7XG4gICAgICAgICAgZXIgPSB7fTtcbiAgICAgICAgICBlci5zdGF0dXMgPSA0MDE7XG4gICAgICAgICAgZXIucmVzcG9uc2VUZXh0ID0ge1xuICAgICAgICAgICAgY29kZTogJ2ludmFsaWRfb3BlcmF0aW9uJ1xuICAgICAgICAgIH07XG4gICAgICAgIC8vIElmIG5vdCBJRTEwLzExIGFuZCBub3Qgb2ZmbGluZSBpdCBtZWFucyB0aGF0IEF1dGgwIGhvc3QgaXMgdW5yZWFjaGFibGU6XG4gICAgICAgIC8vIENvbm5lY3Rpb24gVGltZW91dCBvciBDb25uZWN0aW9uIFJlZnVzZWQuXG4gICAgICAgIH0gZWxzZSBpZiAoemVyb1N0YXR1cykge1xuICAgICAgICAgIGVyID0ge307XG4gICAgICAgICAgZXIuc3RhdHVzID0gMDtcbiAgICAgICAgICBlci5yZXNwb25zZVRleHQgPSB7XG4gICAgICAgICAgICBjb2RlOiAnY29ubmVjdGlvbl9yZWZ1c2VkX3RpbWVvdXQnXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlci5yZXNwb25zZVRleHQgPSBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgY2FsbGJhY2sobmV3IExvZ2luRXJyb3IoZXIuc3RhdHVzLCBlci5yZXNwb25zZVRleHQpKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufTtcblxuLyoqXG4gKiBUcmlnZ2VyIGxvZ291dCByZWRpcmVjdCB3aXRoXG4gKiBwYXJhbXMgZnJvbSBgcXVlcnlgIG9iamVjdFxuICpcbiAqIEBleGFtcGxlXG4gKlxuICogICAgIGF1dGgwLmxvZ291dCgpO1xuICogICAgIC8vIHJlZGlyZWN0cyB0byAtPiAnaHR0cHM6Ly95b3VyYXBwLmF1dGgwLmNvbS9sb2dvdXQnXG4gKlxuICogQGV4YW1wbGVcbiAqXG4gKiAgICAgYXV0aDAubG9nb3V0KHtyZXR1cm5UbzogJ2h0dHA6Ly9sb2dvdXQnfSk7XG4gKiAgICAgLy8gcmVkaXJlY3RzIHRvIC0+ICdodHRwczovL3lvdXJhcHAuYXV0aDAuY29tL2xvZ291dD9yZXR1cm5Ubz1odHRwOi8vbG9nb3V0J1xuICpcbiAqIEBtZXRob2QgbG9nb3V0XG4gKiBAcGFyYW0ge09iamVjdH0gcXVlcnlcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUubG9nb3V0ID0gZnVuY3Rpb24gKHF1ZXJ5KSB7XG4gIHZhciB1cmwgPSBqb2luVXJsKCdodHRwczonLCB0aGlzLl9kb21haW4sICcvbG9nb3V0Jyk7XG4gIGlmIChxdWVyeSkge1xuICAgIHVybCArPSAnPycgKyBxcy5zdHJpbmdpZnkocXVlcnkpO1xuICB9XG4gIHRoaXMuX3JlZGlyZWN0KHVybCk7XG59O1xuXG4vKipcbiAqIEdldCBzaW5nbGUgc2lnbiBvbiBEYXRhXG4gKlxuICogQGV4YW1wbGVcbiAqXG4gKiAgICAgYXV0aDAuZ2V0U1NPRGF0YShmdW5jdGlvbiAoZXJyLCBzc29EYXRhKSB7XG4gKiAgICAgICBpZiAoZXJyKSByZXR1cm4gY29uc29sZS5sb2coZXJyLm1lc3NhZ2UpO1xuICogICAgICAgZXhwZWN0KHNzb0RhdGEuc3NvKS50by5leGlzdDtcbiAqICAgICB9KTtcbiAqXG4gKiBAZXhhbXBsZVxuICpcbiAqICAgICBhdXRoMC5nZXRTU09EYXRhKGZhbHNlLCBmbik7XG4gKlxuICogQG1ldGhvZCBnZXRTU09EYXRhXG4gKiBAcGFyYW0ge0Jvb2xlYW59IHdpdGhBY3RpdmVEaXJlY3Rvcmllc1xuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2tcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuZ2V0U1NPRGF0YSA9IGZ1bmN0aW9uICh3aXRoQWN0aXZlRGlyZWN0b3JpZXMsIGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2Ygd2l0aEFjdGl2ZURpcmVjdG9yaWVzID09PSAnZnVuY3Rpb24nKSB7XG4gICAgY2FsbGJhY2sgPSB3aXRoQWN0aXZlRGlyZWN0b3JpZXM7XG4gICAgd2l0aEFjdGl2ZURpcmVjdG9yaWVzID0gZmFsc2U7XG4gIH1cblxuICB2YXIgdXJsID0gam9pblVybCgnaHR0cHM6JywgdGhpcy5fZG9tYWluLCAnL3VzZXIvc3NvZGF0YScpO1xuXG4gIGlmICh3aXRoQWN0aXZlRGlyZWN0b3JpZXMpIHtcbiAgICB1cmwgKz0gJz8nICsgcXMuc3RyaW5naWZ5KHtsZGFwczogMSwgY2xpZW50X2lkOiB0aGlzLl9jbGllbnRJRH0pO1xuICB9XG5cbiAgLy8gb3ZlcnJpZGUgdGltZW91dFxuICB2YXIganNvbnBPcHRpb25zID0geHRlbmQoe30sIGpzb25wT3B0cywgeyB0aW1lb3V0OiAzMDAwIH0pO1xuXG4gIHJldHVybiBqc29ucCh1cmwsIGpzb25wT3B0aW9ucywgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgIGNhbGxiYWNrKG51bGwsIGVyciA/IHtzc286ZmFsc2V9IDogcmVzcCk7IC8vIEFsd2F5cyByZXR1cm4gT0ssIHJlZ2FyZGxlc3Mgb2YgYW55IGVycm9yc1xuICB9KTtcbn07XG5cbi8qKlxuICogR2V0IGFsbCBjb25maWd1cmVkIGNvbm5lY3Rpb25zIGZvciBhIGNsaWVudFxuICpcbiAqIEBleGFtcGxlXG4gKlxuICogICAgIGF1dGgwLmdldENvbm5lY3Rpb25zKGZ1bmN0aW9uIChlcnIsIGNvbm5zKSB7XG4gKiAgICAgICBpZiAoZXJyKSByZXR1cm4gY29uc29sZS5sb2coZXJyLm1lc3NhZ2UpO1xuICogICAgICAgZXhwZWN0KGNvbm5zLmxlbmd0aCkudG8uYmUuYWJvdmUoMCk7XG4gKiAgICAgICBleHBlY3QoY29ubnNbMF0ubmFtZSkudG8uZXFsKCdBcHByZW5kYS5jb20nKTtcbiAqICAgICAgIGV4cGVjdChjb25uc1swXS5zdHJhdGVneSkudG8uZXFsKCdhZGZzJyk7XG4gKiAgICAgICBleHBlY3QoY29ubnNbMF0uc3RhdHVzKS50by5lcWwoZmFsc2UpO1xuICogICAgICAgZXhwZWN0KGNvbm5zWzBdLmRvbWFpbikudG8uZXFsKCdBcHByZW5kYS5jb20nKTtcbiAqICAgICAgIGV4cGVjdChjb25uc1swXS5kb21haW5fYWxpYXNlcykudG8uZXFsKFsnQXBwcmVuZGEuY29tJywgJ2Zvby5jb20nLCAnYmFyLmNvbSddKTtcbiAqICAgICB9KTtcbiAqXG4gKiBAbWV0aG9kIGdldENvbm5lY3Rpb25zXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICovXG4vLyBYWFggV2UgbWF5IGNoYW5nZSB0aGUgd2F5IHRoaXMgbWV0aG9kIHdvcmtzIGluIHRoZSBmdXR1cmUgdG8gdXNlIGNsaWVudCdzIHMzIGZpbGUuXG5cbkF1dGgwLnByb3RvdHlwZS5nZXRDb25uZWN0aW9ucyA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICByZXR1cm4ganNvbnAoJ2h0dHBzOi8vJyArIHRoaXMuX2RvbWFpbiArICcvcHVibGljL2FwaS8nICsgdGhpcy5fY2xpZW50SUQgKyAnL2Nvbm5lY3Rpb25zJywganNvbnBPcHRzLCBjYWxsYmFjayk7XG59O1xuXG4vKipcbiAqIFNlbmQgZW1haWwgb3IgU01TIHRvIGRvIHBhc3N3b3JkbGVzcyBhdXRoZW50aWNhdGlvblxuICpcbiAqIEBleGFtcGxlXG4gKiAgICAgLy8gVG8gc2VuZCBhbiBlbWFpbFxuICogICAgIGF1dGgwLnN0YXJ0UGFzc3dvcmRsZXNzKHtlbWFpbDogJ2Zvb0BiYXIuY29tJ30sIGZ1bmN0aW9uIChlcnIsIHJlc3VsdCkge1xuICogICAgICAgaWYgKGVycikgcmV0dXJuIGNvbnNvbGUubG9nKGVyci5lcnJvcl9kZXNjcmlwdGlvbik7XG4gKiAgICAgICBjb25zb2xlLmxvZyhyZXN1bHQpO1xuICogICAgIH0pO1xuICpcbiAqIEBleGFtcGxlXG4gKiAgICAgLy8gVG8gc2VuZCBhIFNNU1xuICogICAgIGF1dGgwLnN0YXJ0UGFzc3dvcmRsZXNzKHtwaG9uZU51bWJlcjogJysxNDI1MTExMjIyMid9LCBmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAqICAgICAgIGlmIChlcnIpIHJldHVybiBjb25zb2xlLmxvZyhlcnIuZXJyb3JfZGVzY3JpcHRpb24pO1xuICogICAgICAgY29uc29sZS5sb2cocmVzdWx0KTtcbiAqICAgICB9KTtcbiAqXG4gKiBAbWV0aG9kIHN0YXJ0UGFzc3dvcmRsZXNzXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9uc1xuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2tcbiAqL1xuXG5BdXRoMC5wcm90b3R5cGUuc3RhcnRQYXNzd29yZGxlc3MgPSBmdW5jdGlvbiAob3B0aW9ucywgY2FsbGJhY2spIHtcbiAgaWYgKCdvYmplY3QnICE9PSB0eXBlb2Ygb3B0aW9ucykge1xuICAgIHRocm93IG5ldyBFcnJvcignQW4gb3B0aW9ucyBvYmplY3QgaXMgcmVxdWlyZWQnKTtcbiAgfVxuICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNhbGxiYWNrKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdBIGNhbGxiYWNrIGZ1bmN0aW9uIGlzIHJlcXVpcmVkJyk7XG4gIH1cbiAgaWYgKCFvcHRpb25zLmVtYWlsICYmICFvcHRpb25zLnBob25lTnVtYmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdBbiBgZW1haWxgIG9yIGEgYHBob25lTnVtYmVyYCBpcyByZXF1aXJlZC4nKTtcbiAgfVxuXG4gIHZhciBwcm90b2NvbCA9ICdodHRwczonO1xuICB2YXIgZG9tYWluID0gdGhpcy5fZG9tYWluO1xuICB2YXIgZW5kcG9pbnQgPSAnL3Bhc3N3b3JkbGVzcy9zdGFydCc7XG4gIHZhciB1cmwgPSBqb2luVXJsKHByb3RvY29sLCBkb21haW4sIGVuZHBvaW50KTtcblxuICB2YXIgZGF0YSA9IHtjbGllbnRfaWQ6IHRoaXMuX2NsaWVudElEfTtcbiAgaWYgKG9wdGlvbnMuZW1haWwpIHtcbiAgICBkYXRhLmVtYWlsID0gb3B0aW9ucy5lbWFpbDtcbiAgICBkYXRhLmNvbm5lY3Rpb24gPSAnZW1haWwnO1xuICAgIGlmIChvcHRpb25zLmF1dGhQYXJhbXMpIHtcbiAgICAgIGRhdGEuYXV0aFBhcmFtcyA9IG9wdGlvbnMuYXV0aFBhcmFtcztcbiAgICB9XG5cbiAgICBpZiAoIW9wdGlvbnMuc2VuZCB8fCBvcHRpb25zLnNlbmQgPT09IFwibGlua1wiKSB7XG4gICAgICBpZiAoIWRhdGEuYXV0aFBhcmFtcykge1xuICAgICAgICBkYXRhLmF1dGhQYXJhbXMgPSB7fTtcbiAgICAgIH1cblxuICAgICAgZGF0YS5hdXRoUGFyYW1zLnJlZGlyZWN0X3VyaSA9IHRoaXMuX2NhbGxiYWNrVVJMO1xuICAgICAgZGF0YS5hdXRoUGFyYW1zLnJlc3BvbnNlX3R5cGUgPSB0aGlzLl9zaG91bGRSZWRpcmVjdCAmJiAhdGhpcy5fY2FsbGJhY2tPbkxvY2F0aW9uSGFzaCA/XG4gICAgICAgIFwiY29kZVwiIDogXCJ0b2tlblwiO1xuICAgIH1cblxuICAgIGlmIChvcHRpb25zLnNlbmQpIHtcbiAgICAgIGRhdGEuc2VuZCA9IG9wdGlvbnMuc2VuZDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZGF0YS5waG9uZV9udW1iZXIgPSBvcHRpb25zLnBob25lTnVtYmVyO1xuICAgIGRhdGEuY29ubmVjdGlvbiA9ICdzbXMnO1xuICB9XG5cbiAgaWYgKHRoaXMuX3VzZUpTT05QKSB7XG4gICAgaWYgKHRoaXMuX3NlbmRDbGllbnRJbmZvKSB7XG4gICAgICBkYXRhWydhdXRoMENsaWVudCddID0gdGhpcy5fZ2V0Q2xpZW50SW5mb1N0cmluZygpO1xuICAgIH1cblxuICAgIHJldHVybiBqc29ucCh1cmwgKyAnPycgKyBxcy5zdHJpbmdpZnkoZGF0YSksIGpzb25wT3B0cywgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sobmV3IEVycm9yKDAgKyAnOiAnICsgZXJyLnRvU3RyaW5nKCkpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXNwLnN0YXR1cyA9PT0gMjAwID8gY2FsbGJhY2sobnVsbCwgdHJ1ZSkgOiBjYWxsYmFjayhyZXNwLmVyciB8fCByZXNwLmVycm9yKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiByZXF3ZXN0KHtcbiAgICB1cmw6ICAgICAgICAgIHNhbWVfb3JpZ2luKHByb3RvY29sLCBkb21haW4pID8gZW5kcG9pbnQgOiB1cmwsXG4gICAgbWV0aG9kOiAgICAgICAncG9zdCcsXG4gICAgdHlwZTogICAgICAgICAnanNvbicsXG4gICAgaGVhZGVyczogICAgICB0aGlzLl9nZXRDbGllbnRJbmZvSGVhZGVyKCksXG4gICAgY3Jvc3NPcmlnaW46ICAhc2FtZV9vcmlnaW4ocHJvdG9jb2wsIGRvbWFpbiksXG4gICAgZGF0YTogICAgICAgICBkYXRhXG4gIH0pXG4gIC5mYWlsKGZ1bmN0aW9uIChlcnIpIHtcbiAgICB0cnkge1xuICAgICAgY2FsbGJhY2soSlNPTi5wYXJzZShlcnIucmVzcG9uc2VUZXh0KSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdmFyIGVycm9yID0gbmV3IEVycm9yKGVyci5zdGF0dXMgKyAnKCcgKyBlcnIuc3RhdHVzVGV4dCArICcpOiAnICsgZXJyLnJlc3BvbnNlVGV4dCk7XG4gICAgICBlcnJvci5zdGF0dXNDb2RlID0gZXJyLnN0YXR1cztcbiAgICAgIGVycm9yLmVycm9yID0gZXJyLnN0YXR1c1RleHQ7XG4gICAgICBlcnJvci5tZXNzYWdlID0gZXJyLnJlc3BvbnNlVGV4dDtcbiAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICB9XG4gIH0pXG4gIC50aGVuKGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgICBjYWxsYmFjayhudWxsLCByZXN1bHQpO1xuICB9KTtcbn07XG5cbkF1dGgwLnByb3RvdHlwZS5yZXF1ZXN0TWFnaWNMaW5rID0gZnVuY3Rpb24oYXR0cnMsIGNiKSB7XG4gIHJldHVybiB0aGlzLnN0YXJ0UGFzc3dvcmRsZXNzKGF0dHJzLCBjYik7XG59O1xuXG5BdXRoMC5wcm90b3R5cGUucmVxdWVzdEVtYWlsQ29kZSA9IGZ1bmN0aW9uKGF0dHJzLCBjYikge1xuICBhdHRycy5zZW5kID0gXCJjb2RlXCI7XG4gIHJldHVybiB0aGlzLnN0YXJ0UGFzc3dvcmRsZXNzKGF0dHJzLCBjYik7XG59O1xuXG5BdXRoMC5wcm90b3R5cGUudmVyaWZ5RW1haWxDb2RlID0gZnVuY3Rpb24oYXR0cnMsIGNiKSB7XG4gIGF0dHJzLnBhc3Njb2RlID0gYXR0cnMuY29kZTtcbiAgZGVsZXRlIGF0dHJzLmNvZGU7XG4gIHJldHVybiB0aGlzLmxvZ2luKGF0dHJzLCBjYik7XG59O1xuXG5BdXRoMC5wcm90b3R5cGUucmVxdWVzdFNNU0NvZGUgPSBmdW5jdGlvbihhdHRycywgY2IpIHtcbiAgcmV0dXJuIHRoaXMuc3RhcnRQYXNzd29yZGxlc3MoYXR0cnMsIGNiKTtcbn07XG5cbkF1dGgwLnByb3RvdHlwZS52ZXJpZnlTTVNDb2RlID0gZnVuY3Rpb24oYXR0cnMsIGNiKSB7XG4gIGF0dHJzLnBhc3Njb2RlID0gYXR0cnMuY29kZTtcbiAgZGVsZXRlIGF0dHJzLmNvZGU7XG4gIHJldHVybiB0aGlzLmxvZ2luKGF0dHJzLCBjYik7XG59O1xuXG4vKipcbiAqIEV4cG9zZSBgQXV0aDBgIGNvbnN0cnVjdG9yXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBBdXRoMDtcbiIsIi8qKlxuICogTW9kdWxlIGRlcGVuZGVuY2llcy5cbiAqL1xuXG52YXIganNvbl9wYXJzZSA9IHJlcXVpcmUoJy4vanNvbi1wYXJzZScpO1xuXG4vKipcbiAqIEV4cG9zZSBgTG9naW5FcnJvcmBcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IExvZ2luRXJyb3I7XG5cbi8qKlxuICogQ3JlYXRlIGEgYExvZ2luRXJyb3JgIGJ5IGV4dGVuZCBvZiBgRXJyb3JgXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IHN0YXR1c1xuICogQHBhcmFtIHtTdHJpbmd9IGRldGFpbHNcbiAqIEBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBMb2dpbkVycm9yKHN0YXR1cywgZGV0YWlscykge1xuICB2YXIgb2JqO1xuXG4gIGlmICh0eXBlb2YgZGV0YWlscyA9PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICBvYmogPSBqc29uX3BhcnNlKGRldGFpbHMpO1xuICAgIH0gY2F0Y2ggKGVyKSB7XG4gICAgICBvYmogPSB7IG1lc3NhZ2U6IGRldGFpbHMgfTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgb2JqID0gZGV0YWlscyB8fCB7IGRlc2NyaXB0aW9uOiAnc2VydmVyIGVycm9yJyB9O1xuICB9XG5cbiAgaWYgKCFvYmouY29kZSkge1xuICAgIG9iai5jb2RlID0gb2JqLmVycm9yO1xuICB9XG5cbiAgaWYgKCd1bmF1dGhvcml6ZWQnID09PSBvYmouY29kZSkge1xuICAgIHN0YXR1cyA9IDQwMTtcbiAgfVxuXG4gIHZhciBlcnIgPSBFcnJvci5jYWxsKHRoaXMsIG9iai5kZXNjcmlwdGlvbiB8fCBvYmoubWVzc2FnZSB8fCBvYmouZXJyb3IpO1xuXG4gIGVyci5zdGF0dXMgPSBzdGF0dXM7XG4gIGVyci5uYW1lID0gb2JqLmNvZGU7XG4gIGVyci5jb2RlID0gb2JqLmNvZGU7XG4gIGVyci5kZXRhaWxzID0gb2JqO1xuXG4gIGlmIChzdGF0dXMgPT09IDApIHtcbiAgICBpZiAoIWVyci5jb2RlIHx8IGVyci5jb2RlICE9PSAnb2ZmbGluZScpIHtcbiAgICAgIGVyci5jb2RlID0gJ1Vua25vd24nO1xuICAgICAgZXJyLm1lc3NhZ2UgPSAnVW5rbm93biBlcnJvci4nO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBlcnI7XG59XG5cbi8qKlxuICogRXh0ZW5kIGBMb2dpbkVycm9yLnByb3RvdHlwZWAgd2l0aCBgRXJyb3IucHJvdG90eXBlYFxuICogYW5kIGBMb2dpbkVycm9yYCBhcyBjb25zdHJ1Y3RvclxuICovXG5cbmlmIChPYmplY3QgJiYgT2JqZWN0LmNyZWF0ZSkge1xuICBMb2dpbkVycm9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoRXJyb3IucHJvdG90eXBlLCB7XG4gICAgY29uc3RydWN0b3I6IHsgdmFsdWU6IExvZ2luRXJyb3IgfVxuICB9KTtcbn1cbiIsIi8qKlxuICogRXhwb3NlIGByZXF1aXJlZGBcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmVkO1xuXG4vKipcbiAqIEFzc2VydCBgcHJvcGAgYXMgcmVxdWlyZW1lbnQgb2YgYG9iamBcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcGFyYW0ge3Byb3B9IHByb3BcbiAqIEBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiByZXF1aXJlZCAob2JqLCBwcm9wKSB7XG4gIGlmICghb2JqW3Byb3BdKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKHByb3AgKyAnIGlzIHJlcXVpcmVkLicpO1xuICB9XG59XG4iLCIvKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIEJhc2U2NCA9IHJlcXVpcmUoJ0Jhc2U2NCcpO1xuXG4vKipcbiAqIEV4cG9zZSBgYmFzZTY0X3VybF9kZWNvZGVgXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGVuY29kZTogZW5jb2RlLFxuICBkZWNvZGU6IGRlY29kZVxufTtcblxuLyoqXG4gKiBFbmNvZGUgYSBgYmFzZTY0YCBgZW5jb2RlVVJJQ29tcG9uZW50YCBzdHJpbmdcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gKiBAcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZW5jb2RlKHN0cikge1xuICByZXR1cm4gQmFzZTY0LmJ0b2Eoc3RyKVxuICAgICAgLnJlcGxhY2UoL1xcKy9nLCAnLScpIC8vIENvbnZlcnQgJysnIHRvICctJ1xuICAgICAgLnJlcGxhY2UoL1xcLy9nLCAnXycpIC8vIENvbnZlcnQgJy8nIHRvICdfJ1xuICAgICAgLnJlcGxhY2UoLz0rJC8sICcnKTsgLy8gUmVtb3ZlIGVuZGluZyAnPSdcbn1cblxuLyoqXG4gKiBEZWNvZGUgYSBgYmFzZTY0YCBgZW5jb2RlVVJJQ29tcG9uZW50YCBzdHJpbmdcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gKiBAcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZGVjb2RlKHN0cikge1xuICAvLyBBZGQgcmVtb3ZlZCBhdCBlbmQgJz0nXG4gIHN0ciArPSBBcnJheSg1IC0gc3RyLmxlbmd0aCAlIDQpLmpvaW4oJz0nKTtcblxuICBzdHIgPSBzdHJcbiAgICAucmVwbGFjZSgvXFwtL2csICcrJykgLy8gQ29udmVydCAnLScgdG8gJysnXG4gICAgLnJlcGxhY2UoL1xcXy9nLCAnLycpOyAvLyBDb252ZXJ0ICdfJyB0byAnLydcblxuICByZXR1cm4gQmFzZTY0LmF0b2Ioc3RyKTtcbn0iLCIvKipcbiAqIFJlc29sdmUgYGlzQXJyYXlgIGFzIG5hdGl2ZSBvciBmYWxsYmFja1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2ZcbiAgPyBuYXRpdmVJbmRleE9mXG4gIDogcG9seWZpbGxJbmRleE9mO1xuXG5cbmZ1bmN0aW9uIG5hdGl2ZUluZGV4T2YoYXJyYXksIHNlYXJjaEVsZW1lbnQsIGZyb21JbmRleCkge1xuICByZXR1cm4gYXJyYXkuaW5kZXhPZihzZWFyY2hFbGVtZW50LCBmcm9tSW5kZXgpO1xufVxuXG5cbmZ1bmN0aW9uIHBvbHlmaWxsSW5kZXhPZihhcnJheSwgc2VhcmNoRWxlbWVudCwgZnJvbUluZGV4KSB7XG4gIC8vIFByb2R1Y3Rpb24gc3RlcHMgb2YgRUNNQS0yNjIsIEVkaXRpb24gNSwgMTUuNC40LjE0XG4gIC8vIFJlZmVyZW5jZTogaHR0cDovL2VzNS5naXRodWIuaW8vI3gxNS40LjQuMTRcblxuICB2YXIgaztcblxuICAvLyAxLiBMZXQgTyBiZSB0aGUgcmVzdWx0IG9mIGNhbGxpbmcgVG9PYmplY3QgcGFzc2luZ1xuICAvLyAgICB0aGUgYXJyYXkgdmFsdWUgYXMgdGhlIGFyZ3VtZW50LlxuICBpZiAoYXJyYXkgPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1wiYXJyYXlcIiBpcyBudWxsIG9yIG5vdCBkZWZpbmVkJyk7XG4gIH1cblxuICB2YXIgTyA9IE9iamVjdChhcnJheSk7XG5cbiAgLy8gMi4gTGV0IGxlblZhbHVlIGJlIHRoZSByZXN1bHQgb2YgY2FsbGluZyB0aGUgR2V0XG4gIC8vICAgIGludGVybmFsIG1ldGhvZCBvZiBPIHdpdGggdGhlIGFyZ3VtZW50IFwibGVuZ3RoXCIuXG4gIC8vIDMuIExldCBsZW4gYmUgVG9VaW50MzIobGVuVmFsdWUpLlxuICB2YXIgbGVuID0gTy5sZW5ndGggPj4+IDA7XG5cbiAgLy8gNC4gSWYgbGVuIGlzIDAsIHJldHVybiAtMS5cbiAgaWYgKGxlbiA9PT0gMCkge1xuICAgIHJldHVybiAtMTtcbiAgfVxuXG4gIC8vIDUuIElmIGFyZ3VtZW50IGZyb21JbmRleCB3YXMgcGFzc2VkIGxldCBuIGJlXG4gIC8vICAgIFRvSW50ZWdlcihmcm9tSW5kZXgpOyBlbHNlIGxldCBuIGJlIDAuXG4gIHZhciBuID0gK2Zyb21JbmRleCB8fCAwO1xuXG4gIGlmIChNYXRoLmFicyhuKSA9PT0gSW5maW5pdHkpIHtcbiAgICBuID0gMDtcbiAgfVxuXG4gIC8vIDYuIElmIG4gPj0gbGVuLCByZXR1cm4gLTEuXG4gIGlmIChuID49IGxlbikge1xuICAgIHJldHVybiAtMTtcbiAgfVxuXG4gIC8vIDcuIElmIG4gPj0gMCwgdGhlbiBMZXQgayBiZSBuLlxuICAvLyA4LiBFbHNlLCBuPDAsIExldCBrIGJlIGxlbiAtIGFicyhuKS5cbiAgLy8gICAgSWYgayBpcyBsZXNzIHRoYW4gMCwgdGhlbiBsZXQgayBiZSAwLlxuICBrID0gTWF0aC5tYXgobiA+PSAwID8gbiA6IGxlbiAtIE1hdGguYWJzKG4pLCAwKTtcblxuICAvLyA5LiBSZXBlYXQsIHdoaWxlIGsgPCBsZW5cbiAgd2hpbGUgKGsgPCBsZW4pIHtcbiAgICAvLyBhLiBMZXQgUGsgYmUgVG9TdHJpbmcoaykuXG4gICAgLy8gICBUaGlzIGlzIGltcGxpY2l0IGZvciBMSFMgb3BlcmFuZHMgb2YgdGhlIGluIG9wZXJhdG9yXG4gICAgLy8gYi4gTGV0IGtQcmVzZW50IGJlIHRoZSByZXN1bHQgb2YgY2FsbGluZyB0aGVcbiAgICAvLyAgICBIYXNQcm9wZXJ0eSBpbnRlcm5hbCBtZXRob2Qgb2YgTyB3aXRoIGFyZ3VtZW50IFBrLlxuICAgIC8vICAgVGhpcyBzdGVwIGNhbiBiZSBjb21iaW5lZCB3aXRoIGNcbiAgICAvLyBjLiBJZiBrUHJlc2VudCBpcyB0cnVlLCB0aGVuXG4gICAgLy8gICAgaS4gIExldCBlbGVtZW50SyBiZSB0aGUgcmVzdWx0IG9mIGNhbGxpbmcgdGhlIEdldFxuICAgIC8vICAgICAgICBpbnRlcm5hbCBtZXRob2Qgb2YgTyB3aXRoIHRoZSBhcmd1bWVudCBUb1N0cmluZyhrKS5cbiAgICAvLyAgIGlpLiAgTGV0IHNhbWUgYmUgdGhlIHJlc3VsdCBvZiBhcHBseWluZyB0aGVcbiAgICAvLyAgICAgICAgU3RyaWN0IEVxdWFsaXR5IENvbXBhcmlzb24gQWxnb3JpdGhtIHRvXG4gICAgLy8gICAgICAgIHNlYXJjaEVsZW1lbnQgYW5kIGVsZW1lbnRLLlxuICAgIC8vICBpaWkuICBJZiBzYW1lIGlzIHRydWUsIHJldHVybiBrLlxuICAgIGlmIChrIGluIE8gJiYgT1trXSA9PT0gc2VhcmNoRWxlbWVudCkge1xuICAgICAgcmV0dXJuIGs7XG4gICAgfVxuICAgIGsrKztcbiAgfVxuICByZXR1cm4gLTE7XG59O1xuIiwiLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogUmVzb2x2ZSBgaXNBcnJheWAgYXMgbmF0aXZlIG9yIGZhbGxiYWNrXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBudWxsICE9IEFycmF5LmlzQXJyYXlcbiAgPyBBcnJheS5pc0FycmF5XG4gIDogaXNBcnJheTtcblxuLyoqXG4gKiBXcmFwIGBBcnJheS5pc0FycmF5YCBQb2x5ZmlsbCBmb3IgSUU5XG4gKiBzb3VyY2U6IGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL0FycmF5L2lzQXJyYXlcbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBhcnJheVxuICogQHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGlzQXJyYXkgKGFycmF5KSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKGFycmF5KSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG4iLCIvKipcbiAqIEV4cG9zZSBgSlNPTi5wYXJzZWAgbWV0aG9kIG9yIGZhbGxiYWNrIGlmIG5vdFxuICogZXhpc3RzIG9uIGB3aW5kb3dgXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSAndW5kZWZpbmVkJyA9PT0gdHlwZW9mIHdpbmRvdy5KU09OXG4gID8gcmVxdWlyZSgnanNvbi1mYWxsYmFjaycpLnBhcnNlXG4gIDogd2luZG93LkpTT04ucGFyc2U7XG4iLCIvKipcbiAqIENoZWNrIGZvciBzYW1lIG9yaWdpbiBwb2xpY3lcbiAqL1xuXG52YXIgcHJvdG9jb2wgPSB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2w7XG52YXIgZG9tYWluID0gd2luZG93LmxvY2F0aW9uLmhvc3RuYW1lO1xudmFyIHBvcnQgPSB3aW5kb3cubG9jYXRpb24ucG9ydDtcblxubW9kdWxlLmV4cG9ydHMgPSBzYW1lX29yaWdpbjtcblxuZnVuY3Rpb24gc2FtZV9vcmlnaW4gKHRwcm90b2NvbCwgdGRvbWFpbiwgdHBvcnQpIHtcbiAgdHBvcnQgPSB0cG9ydCB8fCAnJztcbiAgcmV0dXJuIHByb3RvY29sID09PSB0cHJvdG9jb2wgJiYgZG9tYWluID09PSB0ZG9tYWluICYmIHBvcnQgPT09IHRwb3J0O1xufVxuIiwiLyoqXG4gKiBFeHBvc2UgYHVzZV9qc29ucGBcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IHVzZV9qc29ucDtcblxuLyoqXG4gKiBSZXR1cm4gdHJ1ZSBpZiBganNvbnBgIGlzIHJlcXVpcmVkXG4gKlxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiB1c2VfanNvbnAoKSB7XG4gIHZhciB4aHIgPSB3aW5kb3cuWE1MSHR0cFJlcXVlc3QgPyBuZXcgWE1MSHR0cFJlcXVlc3QoKSA6IG51bGw7XG5cbiAgaWYgKHhociAmJiAnd2l0aENyZWRlbnRpYWxzJyBpbiB4aHIpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBXZSBubyBsb25nZXIgc3VwcG9ydCBYRG9tYWluUmVxdWVzdCBmb3IgSUU4IGFuZCBJRTkgZm9yIENPUlMgYmVjYXVzZSBpdCBoYXMgbWFueSBxdWlya3MuXG4gIC8vIGlmICgnWERvbWFpblJlcXVlc3QnIGluIHdpbmRvdyAmJiB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2wgPT09ICdodHRwczonKSB7XG4gIC8vICAgcmV0dXJuIGZhbHNlO1xuICAvLyB9XG5cbiAgcmV0dXJuIHRydWU7XG59IiwiOyhmdW5jdGlvbiAoKSB7XG5cbiAgdmFyXG4gICAgb2JqZWN0ID0gdHlwZW9mIGV4cG9ydHMgIT0gJ3VuZGVmaW5lZCcgPyBleHBvcnRzIDogdGhpcywgLy8gIzg6IHdlYiB3b3JrZXJzXG4gICAgY2hhcnMgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLz0nLFxuICAgIElOVkFMSURfQ0hBUkFDVEVSX0VSUiA9IChmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBmYWJyaWNhdGUgYSBzdWl0YWJsZSBlcnJvciBvYmplY3RcbiAgICAgIHRyeSB7IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJyQnKTsgfVxuICAgICAgY2F0Y2ggKGVycm9yKSB7IHJldHVybiBlcnJvcjsgfX0oKSk7XG5cbiAgLy8gZW5jb2RlclxuICAvLyBbaHR0cHM6Ly9naXN0LmdpdGh1Yi5jb20vOTk5MTY2XSBieSBbaHR0cHM6Ly9naXRodWIuY29tL25pZ25hZ11cbiAgb2JqZWN0LmJ0b2EgfHwgKFxuICBvYmplY3QuYnRvYSA9IGZ1bmN0aW9uIChpbnB1dCkge1xuICAgIGZvciAoXG4gICAgICAvLyBpbml0aWFsaXplIHJlc3VsdCBhbmQgY291bnRlclxuICAgICAgdmFyIGJsb2NrLCBjaGFyQ29kZSwgaWR4ID0gMCwgbWFwID0gY2hhcnMsIG91dHB1dCA9ICcnO1xuICAgICAgLy8gaWYgdGhlIG5leHQgaW5wdXQgaW5kZXggZG9lcyBub3QgZXhpc3Q6XG4gICAgICAvLyAgIGNoYW5nZSB0aGUgbWFwcGluZyB0YWJsZSB0byBcIj1cIlxuICAgICAgLy8gICBjaGVjayBpZiBkIGhhcyBubyBmcmFjdGlvbmFsIGRpZ2l0c1xuICAgICAgaW5wdXQuY2hhckF0KGlkeCB8IDApIHx8IChtYXAgPSAnPScsIGlkeCAlIDEpO1xuICAgICAgLy8gXCI4IC0gaWR4ICUgMSAqIDhcIiBnZW5lcmF0ZXMgdGhlIHNlcXVlbmNlIDIsIDQsIDYsIDhcbiAgICAgIG91dHB1dCArPSBtYXAuY2hhckF0KDYzICYgYmxvY2sgPj4gOCAtIGlkeCAlIDEgKiA4KVxuICAgICkge1xuICAgICAgY2hhckNvZGUgPSBpbnB1dC5jaGFyQ29kZUF0KGlkeCArPSAzLzQpO1xuICAgICAgaWYgKGNoYXJDb2RlID4gMHhGRikgdGhyb3cgSU5WQUxJRF9DSEFSQUNURVJfRVJSO1xuICAgICAgYmxvY2sgPSBibG9jayA8PCA4IHwgY2hhckNvZGU7XG4gICAgfVxuICAgIHJldHVybiBvdXRwdXQ7XG4gIH0pO1xuXG4gIC8vIGRlY29kZXJcbiAgLy8gW2h0dHBzOi8vZ2lzdC5naXRodWIuY29tLzEwMjAzOTZdIGJ5IFtodHRwczovL2dpdGh1Yi5jb20vYXRrXVxuICBvYmplY3QuYXRvYiB8fCAoXG4gIG9iamVjdC5hdG9iID0gZnVuY3Rpb24gKGlucHV0KSB7XG4gICAgaW5wdXQgPSBpbnB1dC5yZXBsYWNlKC89KyQvLCAnJylcbiAgICBpZiAoaW5wdXQubGVuZ3RoICUgNCA9PSAxKSB0aHJvdyBJTlZBTElEX0NIQVJBQ1RFUl9FUlI7XG4gICAgZm9yIChcbiAgICAgIC8vIGluaXRpYWxpemUgcmVzdWx0IGFuZCBjb3VudGVyc1xuICAgICAgdmFyIGJjID0gMCwgYnMsIGJ1ZmZlciwgaWR4ID0gMCwgb3V0cHV0ID0gJyc7XG4gICAgICAvLyBnZXQgbmV4dCBjaGFyYWN0ZXJcbiAgICAgIGJ1ZmZlciA9IGlucHV0LmNoYXJBdChpZHgrKyk7XG4gICAgICAvLyBjaGFyYWN0ZXIgZm91bmQgaW4gdGFibGU/IGluaXRpYWxpemUgYml0IHN0b3JhZ2UgYW5kIGFkZCBpdHMgYXNjaWkgdmFsdWU7XG4gICAgICB+YnVmZmVyICYmIChicyA9IGJjICUgNCA/IGJzICogNjQgKyBidWZmZXIgOiBidWZmZXIsXG4gICAgICAgIC8vIGFuZCBpZiBub3QgZmlyc3Qgb2YgZWFjaCA0IGNoYXJhY3RlcnMsXG4gICAgICAgIC8vIGNvbnZlcnQgdGhlIGZpcnN0IDggYml0cyB0byBvbmUgYXNjaWkgY2hhcmFjdGVyXG4gICAgICAgIGJjKysgJSA0KSA/IG91dHB1dCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKDI1NSAmIGJzID4+ICgtMiAqIGJjICYgNikpIDogMFxuICAgICkge1xuICAgICAgLy8gdHJ5IHRvIGZpbmQgY2hhcmFjdGVyIGluIHRhYmxlICgwLTYzLCBub3QgZm91bmQgPT4gLTEpXG4gICAgICBidWZmZXIgPSBjaGFycy5pbmRleE9mKGJ1ZmZlcik7XG4gICAgfVxuICAgIHJldHVybiBvdXRwdXQ7XG4gIH0pO1xuXG59KCkpO1xuIiwiXG4vKipcbiAqIFRoaXMgaXMgdGhlIHdlYiBicm93c2VyIGltcGxlbWVudGF0aW9uIG9mIGBkZWJ1ZygpYC5cbiAqXG4gKiBFeHBvc2UgYGRlYnVnKClgIGFzIHRoZSBtb2R1bGUuXG4gKi9cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9kZWJ1ZycpO1xuZXhwb3J0cy5sb2cgPSBsb2c7XG5leHBvcnRzLmZvcm1hdEFyZ3MgPSBmb3JtYXRBcmdzO1xuZXhwb3J0cy5zYXZlID0gc2F2ZTtcbmV4cG9ydHMubG9hZCA9IGxvYWQ7XG5leHBvcnRzLnVzZUNvbG9ycyA9IHVzZUNvbG9ycztcblxuLyoqXG4gKiBDb2xvcnMuXG4gKi9cblxuZXhwb3J0cy5jb2xvcnMgPSBbXG4gICdsaWdodHNlYWdyZWVuJyxcbiAgJ2ZvcmVzdGdyZWVuJyxcbiAgJ2dvbGRlbnJvZCcsXG4gICdkb2RnZXJibHVlJyxcbiAgJ2RhcmtvcmNoaWQnLFxuICAnY3JpbXNvbidcbl07XG5cbi8qKlxuICogQ3VycmVudGx5IG9ubHkgV2ViS2l0LWJhc2VkIFdlYiBJbnNwZWN0b3JzLCBGaXJlZm94ID49IHYzMSxcbiAqIGFuZCB0aGUgRmlyZWJ1ZyBleHRlbnNpb24gKGFueSBGaXJlZm94IHZlcnNpb24pIGFyZSBrbm93blxuICogdG8gc3VwcG9ydCBcIiVjXCIgQ1NTIGN1c3RvbWl6YXRpb25zLlxuICpcbiAqIFRPRE86IGFkZCBhIGBsb2NhbFN0b3JhZ2VgIHZhcmlhYmxlIHRvIGV4cGxpY2l0bHkgZW5hYmxlL2Rpc2FibGUgY29sb3JzXG4gKi9cblxuZnVuY3Rpb24gdXNlQ29sb3JzKCkge1xuICAvLyBpcyB3ZWJraXQ/IGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzE2NDU5NjA2LzM3Njc3M1xuICByZXR1cm4gKCdXZWJraXRBcHBlYXJhbmNlJyBpbiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGUpIHx8XG4gICAgLy8gaXMgZmlyZWJ1Zz8gaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL2EvMzk4MTIwLzM3Njc3M1xuICAgICh3aW5kb3cuY29uc29sZSAmJiAoY29uc29sZS5maXJlYnVnIHx8IChjb25zb2xlLmV4Y2VwdGlvbiAmJiBjb25zb2xlLnRhYmxlKSkpIHx8XG4gICAgLy8gaXMgZmlyZWZveCA+PSB2MzE/XG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9Ub29scy9XZWJfQ29uc29sZSNTdHlsaW5nX21lc3NhZ2VzXG4gICAgKG5hdmlnYXRvci51c2VyQWdlbnQudG9Mb3dlckNhc2UoKS5tYXRjaCgvZmlyZWZveFxcLyhcXGQrKS8pICYmIHBhcnNlSW50KFJlZ0V4cC4kMSwgMTApID49IDMxKTtcbn1cblxuLyoqXG4gKiBNYXAgJWogdG8gYEpTT04uc3RyaW5naWZ5KClgLCBzaW5jZSBubyBXZWIgSW5zcGVjdG9ycyBkbyB0aGF0IGJ5IGRlZmF1bHQuXG4gKi9cblxuZXhwb3J0cy5mb3JtYXR0ZXJzLmogPSBmdW5jdGlvbih2KSB7XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeSh2KTtcbn07XG5cblxuLyoqXG4gKiBDb2xvcml6ZSBsb2cgYXJndW1lbnRzIGlmIGVuYWJsZWQuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBmb3JtYXRBcmdzKCkge1xuICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgdmFyIHVzZUNvbG9ycyA9IHRoaXMudXNlQ29sb3JzO1xuXG4gIGFyZ3NbMF0gPSAodXNlQ29sb3JzID8gJyVjJyA6ICcnKVxuICAgICsgdGhpcy5uYW1lc3BhY2VcbiAgICArICh1c2VDb2xvcnMgPyAnICVjJyA6ICcgJylcbiAgICArIGFyZ3NbMF1cbiAgICArICh1c2VDb2xvcnMgPyAnJWMgJyA6ICcgJylcbiAgICArICcrJyArIGV4cG9ydHMuaHVtYW5pemUodGhpcy5kaWZmKTtcblxuICBpZiAoIXVzZUNvbG9ycykgcmV0dXJuIGFyZ3M7XG5cbiAgdmFyIGMgPSAnY29sb3I6ICcgKyB0aGlzLmNvbG9yO1xuICBhcmdzID0gW2FyZ3NbMF0sIGMsICdjb2xvcjogaW5oZXJpdCddLmNvbmNhdChBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmdzLCAxKSk7XG5cbiAgLy8gdGhlIGZpbmFsIFwiJWNcIiBpcyBzb21ld2hhdCB0cmlja3ksIGJlY2F1c2UgdGhlcmUgY291bGQgYmUgb3RoZXJcbiAgLy8gYXJndW1lbnRzIHBhc3NlZCBlaXRoZXIgYmVmb3JlIG9yIGFmdGVyIHRoZSAlYywgc28gd2UgbmVlZCB0b1xuICAvLyBmaWd1cmUgb3V0IHRoZSBjb3JyZWN0IGluZGV4IHRvIGluc2VydCB0aGUgQ1NTIGludG9cbiAgdmFyIGluZGV4ID0gMDtcbiAgdmFyIGxhc3RDID0gMDtcbiAgYXJnc1swXS5yZXBsYWNlKC8lW2EteiVdL2csIGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgaWYgKCclJScgPT09IG1hdGNoKSByZXR1cm47XG4gICAgaW5kZXgrKztcbiAgICBpZiAoJyVjJyA9PT0gbWF0Y2gpIHtcbiAgICAgIC8vIHdlIG9ubHkgYXJlIGludGVyZXN0ZWQgaW4gdGhlICpsYXN0KiAlY1xuICAgICAgLy8gKHRoZSB1c2VyIG1heSBoYXZlIHByb3ZpZGVkIHRoZWlyIG93bilcbiAgICAgIGxhc3RDID0gaW5kZXg7XG4gICAgfVxuICB9KTtcblxuICBhcmdzLnNwbGljZShsYXN0QywgMCwgYyk7XG4gIHJldHVybiBhcmdzO1xufVxuXG4vKipcbiAqIEludm9rZXMgYGNvbnNvbGUubG9nKClgIHdoZW4gYXZhaWxhYmxlLlxuICogTm8tb3Agd2hlbiBgY29uc29sZS5sb2dgIGlzIG5vdCBhIFwiZnVuY3Rpb25cIi5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGxvZygpIHtcbiAgLy8gVGhpcyBoYWNrZXJ5IGlzIHJlcXVpcmVkIGZvciBJRTgsXG4gIC8vIHdoZXJlIHRoZSBgY29uc29sZS5sb2dgIGZ1bmN0aW9uIGRvZXNuJ3QgaGF2ZSAnYXBwbHknXG4gIHJldHVybiAnb2JqZWN0JyA9PSB0eXBlb2YgY29uc29sZVxuICAgICYmICdmdW5jdGlvbicgPT0gdHlwZW9mIGNvbnNvbGUubG9nXG4gICAgJiYgRnVuY3Rpb24ucHJvdG90eXBlLmFwcGx5LmNhbGwoY29uc29sZS5sb2csIGNvbnNvbGUsIGFyZ3VtZW50cyk7XG59XG5cbi8qKlxuICogU2F2ZSBgbmFtZXNwYWNlc2AuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVzcGFjZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNhdmUobmFtZXNwYWNlcykge1xuICB0cnkge1xuICAgIGlmIChudWxsID09IG5hbWVzcGFjZXMpIHtcbiAgICAgIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKCdkZWJ1ZycpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2NhbFN0b3JhZ2UuZGVidWcgPSBuYW1lc3BhY2VzO1xuICAgIH1cbiAgfSBjYXRjaChlKSB7fVxufVxuXG4vKipcbiAqIExvYWQgYG5hbWVzcGFjZXNgLlxuICpcbiAqIEByZXR1cm4ge1N0cmluZ30gcmV0dXJucyB0aGUgcHJldmlvdXNseSBwZXJzaXN0ZWQgZGVidWcgbW9kZXNcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvYWQoKSB7XG4gIHZhciByO1xuICB0cnkge1xuICAgIHIgPSBsb2NhbFN0b3JhZ2UuZGVidWc7XG4gIH0gY2F0Y2goZSkge31cbiAgcmV0dXJuIHI7XG59XG5cbi8qKlxuICogRW5hYmxlIG5hbWVzcGFjZXMgbGlzdGVkIGluIGBsb2NhbFN0b3JhZ2UuZGVidWdgIGluaXRpYWxseS5cbiAqL1xuXG5leHBvcnRzLmVuYWJsZShsb2FkKCkpO1xuIiwiXG4vKipcbiAqIFRoaXMgaXMgdGhlIGNvbW1vbiBsb2dpYyBmb3IgYm90aCB0aGUgTm9kZS5qcyBhbmQgd2ViIGJyb3dzZXJcbiAqIGltcGxlbWVudGF0aW9ucyBvZiBgZGVidWcoKWAuXG4gKlxuICogRXhwb3NlIGBkZWJ1ZygpYCBhcyB0aGUgbW9kdWxlLlxuICovXG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IGRlYnVnO1xuZXhwb3J0cy5jb2VyY2UgPSBjb2VyY2U7XG5leHBvcnRzLmRpc2FibGUgPSBkaXNhYmxlO1xuZXhwb3J0cy5lbmFibGUgPSBlbmFibGU7XG5leHBvcnRzLmVuYWJsZWQgPSBlbmFibGVkO1xuZXhwb3J0cy5odW1hbml6ZSA9IHJlcXVpcmUoJ21zJyk7XG5cbi8qKlxuICogVGhlIGN1cnJlbnRseSBhY3RpdmUgZGVidWcgbW9kZSBuYW1lcywgYW5kIG5hbWVzIHRvIHNraXAuXG4gKi9cblxuZXhwb3J0cy5uYW1lcyA9IFtdO1xuZXhwb3J0cy5za2lwcyA9IFtdO1xuXG4vKipcbiAqIE1hcCBvZiBzcGVjaWFsIFwiJW5cIiBoYW5kbGluZyBmdW5jdGlvbnMsIGZvciB0aGUgZGVidWcgXCJmb3JtYXRcIiBhcmd1bWVudC5cbiAqXG4gKiBWYWxpZCBrZXkgbmFtZXMgYXJlIGEgc2luZ2xlLCBsb3dlcmNhc2VkIGxldHRlciwgaS5lLiBcIm5cIi5cbiAqL1xuXG5leHBvcnRzLmZvcm1hdHRlcnMgPSB7fTtcblxuLyoqXG4gKiBQcmV2aW91c2x5IGFzc2lnbmVkIGNvbG9yLlxuICovXG5cbnZhciBwcmV2Q29sb3IgPSAwO1xuXG4vKipcbiAqIFByZXZpb3VzIGxvZyB0aW1lc3RhbXAuXG4gKi9cblxudmFyIHByZXZUaW1lO1xuXG4vKipcbiAqIFNlbGVjdCBhIGNvbG9yLlxuICpcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHNlbGVjdENvbG9yKCkge1xuICByZXR1cm4gZXhwb3J0cy5jb2xvcnNbcHJldkNvbG9yKysgJSBleHBvcnRzLmNvbG9ycy5sZW5ndGhdO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIGRlYnVnZ2VyIHdpdGggdGhlIGdpdmVuIGBuYW1lc3BhY2VgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VcbiAqIEByZXR1cm4ge0Z1bmN0aW9ufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBkZWJ1ZyhuYW1lc3BhY2UpIHtcblxuICAvLyBkZWZpbmUgdGhlIGBkaXNhYmxlZGAgdmVyc2lvblxuICBmdW5jdGlvbiBkaXNhYmxlZCgpIHtcbiAgfVxuICBkaXNhYmxlZC5lbmFibGVkID0gZmFsc2U7XG5cbiAgLy8gZGVmaW5lIHRoZSBgZW5hYmxlZGAgdmVyc2lvblxuICBmdW5jdGlvbiBlbmFibGVkKCkge1xuXG4gICAgdmFyIHNlbGYgPSBlbmFibGVkO1xuXG4gICAgLy8gc2V0IGBkaWZmYCB0aW1lc3RhbXBcbiAgICB2YXIgY3VyciA9ICtuZXcgRGF0ZSgpO1xuICAgIHZhciBtcyA9IGN1cnIgLSAocHJldlRpbWUgfHwgY3Vycik7XG4gICAgc2VsZi5kaWZmID0gbXM7XG4gICAgc2VsZi5wcmV2ID0gcHJldlRpbWU7XG4gICAgc2VsZi5jdXJyID0gY3VycjtcbiAgICBwcmV2VGltZSA9IGN1cnI7XG5cbiAgICAvLyBhZGQgdGhlIGBjb2xvcmAgaWYgbm90IHNldFxuICAgIGlmIChudWxsID09IHNlbGYudXNlQ29sb3JzKSBzZWxmLnVzZUNvbG9ycyA9IGV4cG9ydHMudXNlQ29sb3JzKCk7XG4gICAgaWYgKG51bGwgPT0gc2VsZi5jb2xvciAmJiBzZWxmLnVzZUNvbG9ycykgc2VsZi5jb2xvciA9IHNlbGVjdENvbG9yKCk7XG5cbiAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG5cbiAgICBhcmdzWzBdID0gZXhwb3J0cy5jb2VyY2UoYXJnc1swXSk7XG5cbiAgICBpZiAoJ3N0cmluZycgIT09IHR5cGVvZiBhcmdzWzBdKSB7XG4gICAgICAvLyBhbnl0aGluZyBlbHNlIGxldCdzIGluc3BlY3Qgd2l0aCAlb1xuICAgICAgYXJncyA9IFsnJW8nXS5jb25jYXQoYXJncyk7XG4gICAgfVxuXG4gICAgLy8gYXBwbHkgYW55IGBmb3JtYXR0ZXJzYCB0cmFuc2Zvcm1hdGlvbnNcbiAgICB2YXIgaW5kZXggPSAwO1xuICAgIGFyZ3NbMF0gPSBhcmdzWzBdLnJlcGxhY2UoLyUoW2EteiVdKS9nLCBmdW5jdGlvbihtYXRjaCwgZm9ybWF0KSB7XG4gICAgICAvLyBpZiB3ZSBlbmNvdW50ZXIgYW4gZXNjYXBlZCAlIHRoZW4gZG9uJ3QgaW5jcmVhc2UgdGhlIGFycmF5IGluZGV4XG4gICAgICBpZiAobWF0Y2ggPT09ICclJScpIHJldHVybiBtYXRjaDtcbiAgICAgIGluZGV4Kys7XG4gICAgICB2YXIgZm9ybWF0dGVyID0gZXhwb3J0cy5mb3JtYXR0ZXJzW2Zvcm1hdF07XG4gICAgICBpZiAoJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGZvcm1hdHRlcikge1xuICAgICAgICB2YXIgdmFsID0gYXJnc1tpbmRleF07XG4gICAgICAgIG1hdGNoID0gZm9ybWF0dGVyLmNhbGwoc2VsZiwgdmFsKTtcblxuICAgICAgICAvLyBub3cgd2UgbmVlZCB0byByZW1vdmUgYGFyZ3NbaW5kZXhdYCBzaW5jZSBpdCdzIGlubGluZWQgaW4gdGhlIGBmb3JtYXRgXG4gICAgICAgIGFyZ3Muc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgaW5kZXgtLTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXRjaDtcbiAgICB9KTtcblxuICAgIGlmICgnZnVuY3Rpb24nID09PSB0eXBlb2YgZXhwb3J0cy5mb3JtYXRBcmdzKSB7XG4gICAgICBhcmdzID0gZXhwb3J0cy5mb3JtYXRBcmdzLmFwcGx5KHNlbGYsIGFyZ3MpO1xuICAgIH1cbiAgICB2YXIgbG9nRm4gPSBlbmFibGVkLmxvZyB8fCBleHBvcnRzLmxvZyB8fCBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuICAgIGxvZ0ZuLmFwcGx5KHNlbGYsIGFyZ3MpO1xuICB9XG4gIGVuYWJsZWQuZW5hYmxlZCA9IHRydWU7XG5cbiAgdmFyIGZuID0gZXhwb3J0cy5lbmFibGVkKG5hbWVzcGFjZSkgPyBlbmFibGVkIDogZGlzYWJsZWQ7XG5cbiAgZm4ubmFtZXNwYWNlID0gbmFtZXNwYWNlO1xuXG4gIHJldHVybiBmbjtcbn1cblxuLyoqXG4gKiBFbmFibGVzIGEgZGVidWcgbW9kZSBieSBuYW1lc3BhY2VzLiBUaGlzIGNhbiBpbmNsdWRlIG1vZGVzXG4gKiBzZXBhcmF0ZWQgYnkgYSBjb2xvbiBhbmQgd2lsZGNhcmRzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lc3BhY2VzXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGVuYWJsZShuYW1lc3BhY2VzKSB7XG4gIGV4cG9ydHMuc2F2ZShuYW1lc3BhY2VzKTtcblxuICB2YXIgc3BsaXQgPSAobmFtZXNwYWNlcyB8fCAnJykuc3BsaXQoL1tcXHMsXSsvKTtcbiAgdmFyIGxlbiA9IHNwbGl0Lmxlbmd0aDtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgaWYgKCFzcGxpdFtpXSkgY29udGludWU7IC8vIGlnbm9yZSBlbXB0eSBzdHJpbmdzXG4gICAgbmFtZXNwYWNlcyA9IHNwbGl0W2ldLnJlcGxhY2UoL1xcKi9nLCAnLio/Jyk7XG4gICAgaWYgKG5hbWVzcGFjZXNbMF0gPT09ICctJykge1xuICAgICAgZXhwb3J0cy5za2lwcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcy5zdWJzdHIoMSkgKyAnJCcpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZXhwb3J0cy5uYW1lcy5wdXNoKG5ldyBSZWdFeHAoJ14nICsgbmFtZXNwYWNlcyArICckJykpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIERpc2FibGUgZGVidWcgb3V0cHV0LlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZGlzYWJsZSgpIHtcbiAgZXhwb3J0cy5lbmFibGUoJycpO1xufVxuXG4vKipcbiAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgZ2l2ZW4gbW9kZSBuYW1lIGlzIGVuYWJsZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZW5hYmxlZChuYW1lKSB7XG4gIHZhciBpLCBsZW47XG4gIGZvciAoaSA9IDAsIGxlbiA9IGV4cG9ydHMuc2tpcHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBpZiAoZXhwb3J0cy5za2lwc1tpXS50ZXN0KG5hbWUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG4gIGZvciAoaSA9IDAsIGxlbiA9IGV4cG9ydHMubmFtZXMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBpZiAoZXhwb3J0cy5uYW1lc1tpXS50ZXN0KG5hbWUpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIENvZXJjZSBgdmFsYC5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSB2YWxcbiAqIEByZXR1cm4ge01peGVkfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gY29lcmNlKHZhbCkge1xuICBpZiAodmFsIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiB2YWwuc3RhY2sgfHwgdmFsLm1lc3NhZ2U7XG4gIHJldHVybiB2YWw7XG59XG4iLCIvKipcbiAqIEhlbHBlcnMuXG4gKi9cblxudmFyIHMgPSAxMDAwO1xudmFyIG0gPSBzICogNjA7XG52YXIgaCA9IG0gKiA2MDtcbnZhciBkID0gaCAqIDI0O1xudmFyIHkgPSBkICogMzY1LjI1O1xuXG4vKipcbiAqIFBhcnNlIG9yIGZvcm1hdCB0aGUgZ2l2ZW4gYHZhbGAuXG4gKlxuICogT3B0aW9uczpcbiAqXG4gKiAgLSBgbG9uZ2AgdmVyYm9zZSBmb3JtYXR0aW5nIFtmYWxzZV1cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ3xOdW1iZXJ9IHZhbFxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEByZXR1cm4ge1N0cmluZ3xOdW1iZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odmFsLCBvcHRpb25zKXtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIGlmICgnc3RyaW5nJyA9PSB0eXBlb2YgdmFsKSByZXR1cm4gcGFyc2UodmFsKTtcbiAgcmV0dXJuIG9wdGlvbnMubG9uZ1xuICAgID8gbG9uZyh2YWwpXG4gICAgOiBzaG9ydCh2YWwpO1xufTtcblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gYHN0cmAgYW5kIHJldHVybiBtaWxsaXNlY29uZHMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7TnVtYmVyfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gcGFyc2Uoc3RyKSB7XG4gIHZhciBtYXRjaCA9IC9eKCg/OlxcZCspP1xcLj9cXGQrKSAqKG1zfHNlY29uZHM/fHN8bWludXRlcz98bXxob3Vycz98aHxkYXlzP3xkfHllYXJzP3x5KT8kL2kuZXhlYyhzdHIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm47XG4gIHZhciBuID0gcGFyc2VGbG9hdChtYXRjaFsxXSk7XG4gIHZhciB0eXBlID0gKG1hdGNoWzJdIHx8ICdtcycpLnRvTG93ZXJDYXNlKCk7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgJ3llYXJzJzpcbiAgICBjYXNlICd5ZWFyJzpcbiAgICBjYXNlICd5JzpcbiAgICAgIHJldHVybiBuICogeTtcbiAgICBjYXNlICdkYXlzJzpcbiAgICBjYXNlICdkYXknOlxuICAgIGNhc2UgJ2QnOlxuICAgICAgcmV0dXJuIG4gKiBkO1xuICAgIGNhc2UgJ2hvdXJzJzpcbiAgICBjYXNlICdob3VyJzpcbiAgICBjYXNlICdoJzpcbiAgICAgIHJldHVybiBuICogaDtcbiAgICBjYXNlICdtaW51dGVzJzpcbiAgICBjYXNlICdtaW51dGUnOlxuICAgIGNhc2UgJ20nOlxuICAgICAgcmV0dXJuIG4gKiBtO1xuICAgIGNhc2UgJ3NlY29uZHMnOlxuICAgIGNhc2UgJ3NlY29uZCc6XG4gICAgY2FzZSAncyc6XG4gICAgICByZXR1cm4gbiAqIHM7XG4gICAgY2FzZSAnbXMnOlxuICAgICAgcmV0dXJuIG47XG4gIH1cbn1cblxuLyoqXG4gKiBTaG9ydCBmb3JtYXQgZm9yIGBtc2AuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG1zXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzaG9ydChtcykge1xuICBpZiAobXMgPj0gZCkgcmV0dXJuIE1hdGgucm91bmQobXMgLyBkKSArICdkJztcbiAgaWYgKG1zID49IGgpIHJldHVybiBNYXRoLnJvdW5kKG1zIC8gaCkgKyAnaCc7XG4gIGlmIChtcyA+PSBtKSByZXR1cm4gTWF0aC5yb3VuZChtcyAvIG0pICsgJ20nO1xuICBpZiAobXMgPj0gcykgcmV0dXJuIE1hdGgucm91bmQobXMgLyBzKSArICdzJztcbiAgcmV0dXJuIG1zICsgJ21zJztcbn1cblxuLyoqXG4gKiBMb25nIGZvcm1hdCBmb3IgYG1zYC5cbiAqXG4gKiBAcGFyYW0ge051bWJlcn0gbXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGxvbmcobXMpIHtcbiAgcmV0dXJuIHBsdXJhbChtcywgZCwgJ2RheScpXG4gICAgfHwgcGx1cmFsKG1zLCBoLCAnaG91cicpXG4gICAgfHwgcGx1cmFsKG1zLCBtLCAnbWludXRlJylcbiAgICB8fCBwbHVyYWwobXMsIHMsICdzZWNvbmQnKVxuICAgIHx8IG1zICsgJyBtcyc7XG59XG5cbi8qKlxuICogUGx1cmFsaXphdGlvbiBoZWxwZXIuXG4gKi9cblxuZnVuY3Rpb24gcGx1cmFsKG1zLCBuLCBuYW1lKSB7XG4gIGlmIChtcyA8IG4pIHJldHVybjtcbiAgaWYgKG1zIDwgbiAqIDEuNSkgcmV0dXJuIE1hdGguZmxvb3IobXMgLyBuKSArICcgJyArIG5hbWU7XG4gIHJldHVybiBNYXRoLmNlaWwobXMgLyBuKSArICcgJyArIG5hbWUgKyAncyc7XG59XG4iLCIvKlxuICAgIGpzb24yLmpzXG4gICAgMjAxMS0xMC0xOVxuXG4gICAgUHVibGljIERvbWFpbi5cblxuICAgIE5PIFdBUlJBTlRZIEVYUFJFU1NFRCBPUiBJTVBMSUVELiBVU0UgQVQgWU9VUiBPV04gUklTSy5cblxuICAgIFNlZSBodHRwOi8vd3d3LkpTT04ub3JnL2pzLmh0bWxcblxuXG4gICAgVGhpcyBjb2RlIHNob3VsZCBiZSBtaW5pZmllZCBiZWZvcmUgZGVwbG95bWVudC5cbiAgICBTZWUgaHR0cDovL2phdmFzY3JpcHQuY3JvY2tmb3JkLmNvbS9qc21pbi5odG1sXG5cbiAgICBVU0UgWU9VUiBPV04gQ09QWS4gSVQgSVMgRVhUUkVNRUxZIFVOV0lTRSBUTyBMT0FEIENPREUgRlJPTSBTRVJWRVJTIFlPVSBET1xuICAgIE5PVCBDT05UUk9MLlxuXG5cbiAgICBUaGlzIGZpbGUgY3JlYXRlcyBhIGdsb2JhbCBKU09OIG9iamVjdCBjb250YWluaW5nIHR3byBtZXRob2RzOiBzdHJpbmdpZnlcbiAgICBhbmQgcGFyc2UuXG5cbiAgICAgICAgSlNPTi5zdHJpbmdpZnkodmFsdWUsIHJlcGxhY2VyLCBzcGFjZSlcbiAgICAgICAgICAgIHZhbHVlICAgICAgIGFueSBKYXZhU2NyaXB0IHZhbHVlLCB1c3VhbGx5IGFuIG9iamVjdCBvciBhcnJheS5cblxuICAgICAgICAgICAgcmVwbGFjZXIgICAgYW4gb3B0aW9uYWwgcGFyYW1ldGVyIHRoYXQgZGV0ZXJtaW5lcyBob3cgb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZXMgYXJlIHN0cmluZ2lmaWVkIGZvciBvYmplY3RzLiBJdCBjYW4gYmUgYVxuICAgICAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24gb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncy5cblxuICAgICAgICAgICAgc3BhY2UgICAgICAgYW4gb3B0aW9uYWwgcGFyYW1ldGVyIHRoYXQgc3BlY2lmaWVzIHRoZSBpbmRlbnRhdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgb2YgbmVzdGVkIHN0cnVjdHVyZXMuIElmIGl0IGlzIG9taXR0ZWQsIHRoZSB0ZXh0IHdpbGxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlIHBhY2tlZCB3aXRob3V0IGV4dHJhIHdoaXRlc3BhY2UuIElmIGl0IGlzIGEgbnVtYmVyLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXQgd2lsbCBzcGVjaWZ5IHRoZSBudW1iZXIgb2Ygc3BhY2VzIHRvIGluZGVudCBhdCBlYWNoXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXZlbC4gSWYgaXQgaXMgYSBzdHJpbmcgKHN1Y2ggYXMgJ1xcdCcgb3IgJyZuYnNwOycpLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXQgY29udGFpbnMgdGhlIGNoYXJhY3RlcnMgdXNlZCB0byBpbmRlbnQgYXQgZWFjaCBsZXZlbC5cblxuICAgICAgICAgICAgVGhpcyBtZXRob2QgcHJvZHVjZXMgYSBKU09OIHRleHQgZnJvbSBhIEphdmFTY3JpcHQgdmFsdWUuXG5cbiAgICAgICAgICAgIFdoZW4gYW4gb2JqZWN0IHZhbHVlIGlzIGZvdW5kLCBpZiB0aGUgb2JqZWN0IGNvbnRhaW5zIGEgdG9KU09OXG4gICAgICAgICAgICBtZXRob2QsIGl0cyB0b0pTT04gbWV0aG9kIHdpbGwgYmUgY2FsbGVkIGFuZCB0aGUgcmVzdWx0IHdpbGwgYmVcbiAgICAgICAgICAgIHN0cmluZ2lmaWVkLiBBIHRvSlNPTiBtZXRob2QgZG9lcyBub3Qgc2VyaWFsaXplOiBpdCByZXR1cm5zIHRoZVxuICAgICAgICAgICAgdmFsdWUgcmVwcmVzZW50ZWQgYnkgdGhlIG5hbWUvdmFsdWUgcGFpciB0aGF0IHNob3VsZCBiZSBzZXJpYWxpemVkLFxuICAgICAgICAgICAgb3IgdW5kZWZpbmVkIGlmIG5vdGhpbmcgc2hvdWxkIGJlIHNlcmlhbGl6ZWQuIFRoZSB0b0pTT04gbWV0aG9kXG4gICAgICAgICAgICB3aWxsIGJlIHBhc3NlZCB0aGUga2V5IGFzc29jaWF0ZWQgd2l0aCB0aGUgdmFsdWUsIGFuZCB0aGlzIHdpbGwgYmVcbiAgICAgICAgICAgIGJvdW5kIHRvIHRoZSB2YWx1ZVxuXG4gICAgICAgICAgICBGb3IgZXhhbXBsZSwgdGhpcyB3b3VsZCBzZXJpYWxpemUgRGF0ZXMgYXMgSVNPIHN0cmluZ3MuXG5cbiAgICAgICAgICAgICAgICBEYXRlLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uIGYobikge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9ybWF0IGludGVnZXJzIHRvIGhhdmUgYXQgbGVhc3QgdHdvIGRpZ2l0cy5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuIDwgMTAgPyAnMCcgKyBuIDogbjtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldFVUQ0Z1bGxZZWFyKCkgICArICctJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgZih0aGlzLmdldFVUQ01vbnRoKCkgKyAxKSArICctJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgZih0aGlzLmdldFVUQ0RhdGUoKSkgICAgICArICdUJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgZih0aGlzLmdldFVUQ0hvdXJzKCkpICAgICArICc6JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgZih0aGlzLmdldFVUQ01pbnV0ZXMoKSkgICArICc6JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgZih0aGlzLmdldFVUQ1NlY29uZHMoKSkgICArICdaJztcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBZb3UgY2FuIHByb3ZpZGUgYW4gb3B0aW9uYWwgcmVwbGFjZXIgbWV0aG9kLiBJdCB3aWxsIGJlIHBhc3NlZCB0aGVcbiAgICAgICAgICAgIGtleSBhbmQgdmFsdWUgb2YgZWFjaCBtZW1iZXIsIHdpdGggdGhpcyBib3VuZCB0byB0aGUgY29udGFpbmluZ1xuICAgICAgICAgICAgb2JqZWN0LiBUaGUgdmFsdWUgdGhhdCBpcyByZXR1cm5lZCBmcm9tIHlvdXIgbWV0aG9kIHdpbGwgYmVcbiAgICAgICAgICAgIHNlcmlhbGl6ZWQuIElmIHlvdXIgbWV0aG9kIHJldHVybnMgdW5kZWZpbmVkLCB0aGVuIHRoZSBtZW1iZXIgd2lsbFxuICAgICAgICAgICAgYmUgZXhjbHVkZWQgZnJvbSB0aGUgc2VyaWFsaXphdGlvbi5cblxuICAgICAgICAgICAgSWYgdGhlIHJlcGxhY2VyIHBhcmFtZXRlciBpcyBhbiBhcnJheSBvZiBzdHJpbmdzLCB0aGVuIGl0IHdpbGwgYmVcbiAgICAgICAgICAgIHVzZWQgdG8gc2VsZWN0IHRoZSBtZW1iZXJzIHRvIGJlIHNlcmlhbGl6ZWQuIEl0IGZpbHRlcnMgdGhlIHJlc3VsdHNcbiAgICAgICAgICAgIHN1Y2ggdGhhdCBvbmx5IG1lbWJlcnMgd2l0aCBrZXlzIGxpc3RlZCBpbiB0aGUgcmVwbGFjZXIgYXJyYXkgYXJlXG4gICAgICAgICAgICBzdHJpbmdpZmllZC5cblxuICAgICAgICAgICAgVmFsdWVzIHRoYXQgZG8gbm90IGhhdmUgSlNPTiByZXByZXNlbnRhdGlvbnMsIHN1Y2ggYXMgdW5kZWZpbmVkIG9yXG4gICAgICAgICAgICBmdW5jdGlvbnMsIHdpbGwgbm90IGJlIHNlcmlhbGl6ZWQuIFN1Y2ggdmFsdWVzIGluIG9iamVjdHMgd2lsbCBiZVxuICAgICAgICAgICAgZHJvcHBlZDsgaW4gYXJyYXlzIHRoZXkgd2lsbCBiZSByZXBsYWNlZCB3aXRoIG51bGwuIFlvdSBjYW4gdXNlXG4gICAgICAgICAgICBhIHJlcGxhY2VyIGZ1bmN0aW9uIHRvIHJlcGxhY2UgdGhvc2Ugd2l0aCBKU09OIHZhbHVlcy5cbiAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHVuZGVmaW5lZCkgcmV0dXJucyB1bmRlZmluZWQuXG5cbiAgICAgICAgICAgIFRoZSBvcHRpb25hbCBzcGFjZSBwYXJhbWV0ZXIgcHJvZHVjZXMgYSBzdHJpbmdpZmljYXRpb24gb2YgdGhlXG4gICAgICAgICAgICB2YWx1ZSB0aGF0IGlzIGZpbGxlZCB3aXRoIGxpbmUgYnJlYWtzIGFuZCBpbmRlbnRhdGlvbiB0byBtYWtlIGl0XG4gICAgICAgICAgICBlYXNpZXIgdG8gcmVhZC5cblxuICAgICAgICAgICAgSWYgdGhlIHNwYWNlIHBhcmFtZXRlciBpcyBhIG5vbi1lbXB0eSBzdHJpbmcsIHRoZW4gdGhhdCBzdHJpbmcgd2lsbFxuICAgICAgICAgICAgYmUgdXNlZCBmb3IgaW5kZW50YXRpb24uIElmIHRoZSBzcGFjZSBwYXJhbWV0ZXIgaXMgYSBudW1iZXIsIHRoZW5cbiAgICAgICAgICAgIHRoZSBpbmRlbnRhdGlvbiB3aWxsIGJlIHRoYXQgbWFueSBzcGFjZXMuXG5cbiAgICAgICAgICAgIEV4YW1wbGU6XG5cbiAgICAgICAgICAgIHRleHQgPSBKU09OLnN0cmluZ2lmeShbJ2UnLCB7cGx1cmlidXM6ICd1bnVtJ31dKTtcbiAgICAgICAgICAgIC8vIHRleHQgaXMgJ1tcImVcIix7XCJwbHVyaWJ1c1wiOlwidW51bVwifV0nXG5cblxuICAgICAgICAgICAgdGV4dCA9IEpTT04uc3RyaW5naWZ5KFsnZScsIHtwbHVyaWJ1czogJ3VudW0nfV0sIG51bGwsICdcXHQnKTtcbiAgICAgICAgICAgIC8vIHRleHQgaXMgJ1tcXG5cXHRcImVcIixcXG5cXHR7XFxuXFx0XFx0XCJwbHVyaWJ1c1wiOiBcInVudW1cIlxcblxcdH1cXG5dJ1xuXG4gICAgICAgICAgICB0ZXh0ID0gSlNPTi5zdHJpbmdpZnkoW25ldyBEYXRlKCldLCBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzW2tleV0gaW5zdGFuY2VvZiBEYXRlID9cbiAgICAgICAgICAgICAgICAgICAgJ0RhdGUoJyArIHRoaXNba2V5XSArICcpJyA6IHZhbHVlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvLyB0ZXh0IGlzICdbXCJEYXRlKC0tLWN1cnJlbnQgdGltZS0tLSlcIl0nXG5cblxuICAgICAgICBKU09OLnBhcnNlKHRleHQsIHJldml2ZXIpXG4gICAgICAgICAgICBUaGlzIG1ldGhvZCBwYXJzZXMgYSBKU09OIHRleHQgdG8gcHJvZHVjZSBhbiBvYmplY3Qgb3IgYXJyYXkuXG4gICAgICAgICAgICBJdCBjYW4gdGhyb3cgYSBTeW50YXhFcnJvciBleGNlcHRpb24uXG5cbiAgICAgICAgICAgIFRoZSBvcHRpb25hbCByZXZpdmVyIHBhcmFtZXRlciBpcyBhIGZ1bmN0aW9uIHRoYXQgY2FuIGZpbHRlciBhbmRcbiAgICAgICAgICAgIHRyYW5zZm9ybSB0aGUgcmVzdWx0cy4gSXQgcmVjZWl2ZXMgZWFjaCBvZiB0aGUga2V5cyBhbmQgdmFsdWVzLFxuICAgICAgICAgICAgYW5kIGl0cyByZXR1cm4gdmFsdWUgaXMgdXNlZCBpbnN0ZWFkIG9mIHRoZSBvcmlnaW5hbCB2YWx1ZS5cbiAgICAgICAgICAgIElmIGl0IHJldHVybnMgd2hhdCBpdCByZWNlaXZlZCwgdGhlbiB0aGUgc3RydWN0dXJlIGlzIG5vdCBtb2RpZmllZC5cbiAgICAgICAgICAgIElmIGl0IHJldHVybnMgdW5kZWZpbmVkIHRoZW4gdGhlIG1lbWJlciBpcyBkZWxldGVkLlxuXG4gICAgICAgICAgICBFeGFtcGxlOlxuXG4gICAgICAgICAgICAvLyBQYXJzZSB0aGUgdGV4dC4gVmFsdWVzIHRoYXQgbG9vayBsaWtlIElTTyBkYXRlIHN0cmluZ3Mgd2lsbFxuICAgICAgICAgICAgLy8gYmUgY29udmVydGVkIHRvIERhdGUgb2JqZWN0cy5cblxuICAgICAgICAgICAgbXlEYXRhID0gSlNPTi5wYXJzZSh0ZXh0LCBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHZhciBhO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgICAgIGEgPVxuL14oXFxkezR9KS0oXFxkezJ9KS0oXFxkezJ9KVQoXFxkezJ9KTooXFxkezJ9KTooXFxkezJ9KD86XFwuXFxkKik/KVokLy5leGVjKHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgRGF0ZShEYXRlLlVUQygrYVsxXSwgK2FbMl0gLSAxLCArYVszXSwgK2FbNF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgK2FbNV0sICthWzZdKSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIG15RGF0YSA9IEpTT04ucGFyc2UoJ1tcIkRhdGUoMDkvMDkvMjAwMSlcIl0nLCBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHZhciBkO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnICYmXG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZS5zbGljZSgwLCA1KSA9PT0gJ0RhdGUoJyAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWUuc2xpY2UoLTEpID09PSAnKScpIHtcbiAgICAgICAgICAgICAgICAgICAgZCA9IG5ldyBEYXRlKHZhbHVlLnNsaWNlKDUsIC0xKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgICAgICB9KTtcblxuXG4gICAgVGhpcyBpcyBhIHJlZmVyZW5jZSBpbXBsZW1lbnRhdGlvbi4gWW91IGFyZSBmcmVlIHRvIGNvcHksIG1vZGlmeSwgb3JcbiAgICByZWRpc3RyaWJ1dGUuXG4qL1xuXG4vKmpzbGludCBldmlsOiB0cnVlLCByZWdleHA6IHRydWUgKi9cblxuLyptZW1iZXJzIFwiXCIsIFwiXFxiXCIsIFwiXFx0XCIsIFwiXFxuXCIsIFwiXFxmXCIsIFwiXFxyXCIsIFwiXFxcIlwiLCBKU09OLCBcIlxcXFxcIiwgYXBwbHksXG4gICAgY2FsbCwgY2hhckNvZGVBdCwgZ2V0VVRDRGF0ZSwgZ2V0VVRDRnVsbFllYXIsIGdldFVUQ0hvdXJzLFxuICAgIGdldFVUQ01pbnV0ZXMsIGdldFVUQ01vbnRoLCBnZXRVVENTZWNvbmRzLCBoYXNPd25Qcm9wZXJ0eSwgam9pbixcbiAgICBsYXN0SW5kZXgsIGxlbmd0aCwgcGFyc2UsIHByb3RvdHlwZSwgcHVzaCwgcmVwbGFjZSwgc2xpY2UsIHN0cmluZ2lmeSxcbiAgICB0ZXN0LCB0b0pTT04sIHRvU3RyaW5nLCB2YWx1ZU9mXG4qL1xuXG5cbi8vIENyZWF0ZSBhIEpTT04gb2JqZWN0IG9ubHkgaWYgb25lIGRvZXMgbm90IGFscmVhZHkgZXhpc3QuIFdlIGNyZWF0ZSB0aGVcbi8vIG1ldGhvZHMgaW4gYSBjbG9zdXJlIHRvIGF2b2lkIGNyZWF0aW5nIGdsb2JhbCB2YXJpYWJsZXMuXG5cbnZhciBKU09OID0ge307XG5cbihmdW5jdGlvbiAoKSB7XG4gICAgJ3VzZSBzdHJpY3QnO1xuXG4gICAgZnVuY3Rpb24gZihuKSB7XG4gICAgICAgIC8vIEZvcm1hdCBpbnRlZ2VycyB0byBoYXZlIGF0IGxlYXN0IHR3byBkaWdpdHMuXG4gICAgICAgIHJldHVybiBuIDwgMTAgPyAnMCcgKyBuIDogbjtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIERhdGUucHJvdG90eXBlLnRvSlNPTiAhPT0gJ2Z1bmN0aW9uJykge1xuXG4gICAgICAgIERhdGUucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIChrZXkpIHtcblxuICAgICAgICAgICAgcmV0dXJuIGlzRmluaXRlKHRoaXMudmFsdWVPZigpKVxuICAgICAgICAgICAgICAgID8gdGhpcy5nZXRVVENGdWxsWWVhcigpICAgICArICctJyArXG4gICAgICAgICAgICAgICAgICAgIGYodGhpcy5nZXRVVENNb250aCgpICsgMSkgKyAnLScgK1xuICAgICAgICAgICAgICAgICAgICBmKHRoaXMuZ2V0VVRDRGF0ZSgpKSAgICAgICsgJ1QnICtcbiAgICAgICAgICAgICAgICAgICAgZih0aGlzLmdldFVUQ0hvdXJzKCkpICAgICArICc6JyArXG4gICAgICAgICAgICAgICAgICAgIGYodGhpcy5nZXRVVENNaW51dGVzKCkpICAgKyAnOicgK1xuICAgICAgICAgICAgICAgICAgICBmKHRoaXMuZ2V0VVRDU2Vjb25kcygpKSAgICsgJ1onXG4gICAgICAgICAgICAgICAgOiBudWxsO1xuICAgICAgICB9O1xuXG4gICAgICAgIFN0cmluZy5wcm90b3R5cGUudG9KU09OICAgICAgPVxuICAgICAgICAgICAgTnVtYmVyLnByb3RvdHlwZS50b0pTT04gID1cbiAgICAgICAgICAgIEJvb2xlYW4ucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy52YWx1ZU9mKCk7XG4gICAgICAgICAgICB9O1xuICAgIH1cblxuICAgIHZhciBjeCA9IC9bXFx1MDAwMFxcdTAwYWRcXHUwNjAwLVxcdTA2MDRcXHUwNzBmXFx1MTdiNFxcdTE3YjVcXHUyMDBjLVxcdTIwMGZcXHUyMDI4LVxcdTIwMmZcXHUyMDYwLVxcdTIwNmZcXHVmZWZmXFx1ZmZmMC1cXHVmZmZmXS9nLFxuICAgICAgICBlc2NhcGFibGUgPSAvW1xcXFxcXFwiXFx4MDAtXFx4MWZcXHg3Zi1cXHg5ZlxcdTAwYWRcXHUwNjAwLVxcdTA2MDRcXHUwNzBmXFx1MTdiNFxcdTE3YjVcXHUyMDBjLVxcdTIwMGZcXHUyMDI4LVxcdTIwMmZcXHUyMDYwLVxcdTIwNmZcXHVmZWZmXFx1ZmZmMC1cXHVmZmZmXS9nLFxuICAgICAgICBnYXAsXG4gICAgICAgIGluZGVudCxcbiAgICAgICAgbWV0YSA9IHsgICAgLy8gdGFibGUgb2YgY2hhcmFjdGVyIHN1YnN0aXR1dGlvbnNcbiAgICAgICAgICAgICdcXGInOiAnXFxcXGInLFxuICAgICAgICAgICAgJ1xcdCc6ICdcXFxcdCcsXG4gICAgICAgICAgICAnXFxuJzogJ1xcXFxuJyxcbiAgICAgICAgICAgICdcXGYnOiAnXFxcXGYnLFxuICAgICAgICAgICAgJ1xccic6ICdcXFxccicsXG4gICAgICAgICAgICAnXCInIDogJ1xcXFxcIicsXG4gICAgICAgICAgICAnXFxcXCc6ICdcXFxcXFxcXCdcbiAgICAgICAgfSxcbiAgICAgICAgcmVwO1xuXG5cbiAgICBmdW5jdGlvbiBxdW90ZShzdHJpbmcpIHtcblxuLy8gSWYgdGhlIHN0cmluZyBjb250YWlucyBubyBjb250cm9sIGNoYXJhY3RlcnMsIG5vIHF1b3RlIGNoYXJhY3RlcnMsIGFuZCBub1xuLy8gYmFja3NsYXNoIGNoYXJhY3RlcnMsIHRoZW4gd2UgY2FuIHNhZmVseSBzbGFwIHNvbWUgcXVvdGVzIGFyb3VuZCBpdC5cbi8vIE90aGVyd2lzZSB3ZSBtdXN0IGFsc28gcmVwbGFjZSB0aGUgb2ZmZW5kaW5nIGNoYXJhY3RlcnMgd2l0aCBzYWZlIGVzY2FwZVxuLy8gc2VxdWVuY2VzLlxuXG4gICAgICAgIGVzY2FwYWJsZS5sYXN0SW5kZXggPSAwO1xuICAgICAgICByZXR1cm4gZXNjYXBhYmxlLnRlc3Qoc3RyaW5nKSA/ICdcIicgKyBzdHJpbmcucmVwbGFjZShlc2NhcGFibGUsIGZ1bmN0aW9uIChhKSB7XG4gICAgICAgICAgICB2YXIgYyA9IG1ldGFbYV07XG4gICAgICAgICAgICByZXR1cm4gdHlwZW9mIGMgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICAgICAgPyBjXG4gICAgICAgICAgICAgICAgOiAnXFxcXHUnICsgKCcwMDAwJyArIGEuY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikpLnNsaWNlKC00KTtcbiAgICAgICAgfSkgKyAnXCInIDogJ1wiJyArIHN0cmluZyArICdcIic7XG4gICAgfVxuXG5cbiAgICBmdW5jdGlvbiBzdHIoa2V5LCBob2xkZXIpIHtcblxuLy8gUHJvZHVjZSBhIHN0cmluZyBmcm9tIGhvbGRlcltrZXldLlxuXG4gICAgICAgIHZhciBpLCAgICAgICAgICAvLyBUaGUgbG9vcCBjb3VudGVyLlxuICAgICAgICAgICAgaywgICAgICAgICAgLy8gVGhlIG1lbWJlciBrZXkuXG4gICAgICAgICAgICB2LCAgICAgICAgICAvLyBUaGUgbWVtYmVyIHZhbHVlLlxuICAgICAgICAgICAgbGVuZ3RoLFxuICAgICAgICAgICAgbWluZCA9IGdhcCxcbiAgICAgICAgICAgIHBhcnRpYWwsXG4gICAgICAgICAgICB2YWx1ZSA9IGhvbGRlcltrZXldO1xuXG4vLyBJZiB0aGUgdmFsdWUgaGFzIGEgdG9KU09OIG1ldGhvZCwgY2FsbCBpdCB0byBvYnRhaW4gYSByZXBsYWNlbWVudCB2YWx1ZS5cblxuICAgICAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgICAgICAgICAgIHR5cGVvZiB2YWx1ZS50b0pTT04gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHZhbHVlID0gdmFsdWUudG9KU09OKGtleSk7XG4gICAgICAgIH1cblxuLy8gSWYgd2Ugd2VyZSBjYWxsZWQgd2l0aCBhIHJlcGxhY2VyIGZ1bmN0aW9uLCB0aGVuIGNhbGwgdGhlIHJlcGxhY2VyIHRvXG4vLyBvYnRhaW4gYSByZXBsYWNlbWVudCB2YWx1ZS5cblxuICAgICAgICBpZiAodHlwZW9mIHJlcCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgdmFsdWUgPSByZXAuY2FsbChob2xkZXIsIGtleSwgdmFsdWUpO1xuICAgICAgICB9XG5cbi8vIFdoYXQgaGFwcGVucyBuZXh0IGRlcGVuZHMgb24gdGhlIHZhbHVlJ3MgdHlwZS5cblxuICAgICAgICBzd2l0Y2ggKHR5cGVvZiB2YWx1ZSkge1xuICAgICAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgICAgICAgcmV0dXJuIHF1b3RlKHZhbHVlKTtcblxuICAgICAgICBjYXNlICdudW1iZXInOlxuXG4vLyBKU09OIG51bWJlcnMgbXVzdCBiZSBmaW5pdGUuIEVuY29kZSBub24tZmluaXRlIG51bWJlcnMgYXMgbnVsbC5cblxuICAgICAgICAgICAgcmV0dXJuIGlzRmluaXRlKHZhbHVlKSA/IFN0cmluZyh2YWx1ZSkgOiAnbnVsbCc7XG5cbiAgICAgICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICAgIGNhc2UgJ251bGwnOlxuXG4vLyBJZiB0aGUgdmFsdWUgaXMgYSBib29sZWFuIG9yIG51bGwsIGNvbnZlcnQgaXQgdG8gYSBzdHJpbmcuIE5vdGU6XG4vLyB0eXBlb2YgbnVsbCBkb2VzIG5vdCBwcm9kdWNlICdudWxsJy4gVGhlIGNhc2UgaXMgaW5jbHVkZWQgaGVyZSBpblxuLy8gdGhlIHJlbW90ZSBjaGFuY2UgdGhhdCB0aGlzIGdldHMgZml4ZWQgc29tZWRheS5cblxuICAgICAgICAgICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG5cbi8vIElmIHRoZSB0eXBlIGlzICdvYmplY3QnLCB3ZSBtaWdodCBiZSBkZWFsaW5nIHdpdGggYW4gb2JqZWN0IG9yIGFuIGFycmF5IG9yXG4vLyBudWxsLlxuXG4gICAgICAgIGNhc2UgJ29iamVjdCc6XG5cbi8vIER1ZSB0byBhIHNwZWNpZmljYXRpb24gYmx1bmRlciBpbiBFQ01BU2NyaXB0LCB0eXBlb2YgbnVsbCBpcyAnb2JqZWN0Jyxcbi8vIHNvIHdhdGNoIG91dCBmb3IgdGhhdCBjYXNlLlxuXG4gICAgICAgICAgICBpZiAoIXZhbHVlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdudWxsJztcbiAgICAgICAgICAgIH1cblxuLy8gTWFrZSBhbiBhcnJheSB0byBob2xkIHRoZSBwYXJ0aWFsIHJlc3VsdHMgb2Ygc3RyaW5naWZ5aW5nIHRoaXMgb2JqZWN0IHZhbHVlLlxuXG4gICAgICAgICAgICBnYXAgKz0gaW5kZW50O1xuICAgICAgICAgICAgcGFydGlhbCA9IFtdO1xuXG4vLyBJcyB0aGUgdmFsdWUgYW4gYXJyYXk/XG5cbiAgICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmFwcGx5KHZhbHVlKSA9PT0gJ1tvYmplY3QgQXJyYXldJykge1xuXG4vLyBUaGUgdmFsdWUgaXMgYW4gYXJyYXkuIFN0cmluZ2lmeSBldmVyeSBlbGVtZW50LiBVc2UgbnVsbCBhcyBhIHBsYWNlaG9sZGVyXG4vLyBmb3Igbm9uLUpTT04gdmFsdWVzLlxuXG4gICAgICAgICAgICAgICAgbGVuZ3RoID0gdmFsdWUubGVuZ3RoO1xuICAgICAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgICAgICBwYXJ0aWFsW2ldID0gc3RyKGksIHZhbHVlKSB8fCAnbnVsbCc7XG4gICAgICAgICAgICAgICAgfVxuXG4vLyBKb2luIGFsbCBvZiB0aGUgZWxlbWVudHMgdG9nZXRoZXIsIHNlcGFyYXRlZCB3aXRoIGNvbW1hcywgYW5kIHdyYXAgdGhlbSBpblxuLy8gYnJhY2tldHMuXG5cbiAgICAgICAgICAgICAgICB2ID0gcGFydGlhbC5sZW5ndGggPT09IDBcbiAgICAgICAgICAgICAgICAgICAgPyAnW10nXG4gICAgICAgICAgICAgICAgICAgIDogZ2FwXG4gICAgICAgICAgICAgICAgICAgID8gJ1tcXG4nICsgZ2FwICsgcGFydGlhbC5qb2luKCcsXFxuJyArIGdhcCkgKyAnXFxuJyArIG1pbmQgKyAnXSdcbiAgICAgICAgICAgICAgICAgICAgOiAnWycgKyBwYXJ0aWFsLmpvaW4oJywnKSArICddJztcbiAgICAgICAgICAgICAgICBnYXAgPSBtaW5kO1xuICAgICAgICAgICAgICAgIHJldHVybiB2O1xuICAgICAgICAgICAgfVxuXG4vLyBJZiB0aGUgcmVwbGFjZXIgaXMgYW4gYXJyYXksIHVzZSBpdCB0byBzZWxlY3QgdGhlIG1lbWJlcnMgdG8gYmUgc3RyaW5naWZpZWQuXG5cbiAgICAgICAgICAgIGlmIChyZXAgJiYgdHlwZW9mIHJlcCA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICBsZW5ndGggPSByZXAubGVuZ3RoO1xuICAgICAgICAgICAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHJlcFtpXSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGsgPSByZXBbaV07XG4gICAgICAgICAgICAgICAgICAgICAgICB2ID0gc3RyKGssIHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh2KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFydGlhbC5wdXNoKHF1b3RlKGspICsgKGdhcCA/ICc6ICcgOiAnOicpICsgdik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuXG4vLyBPdGhlcndpc2UsIGl0ZXJhdGUgdGhyb3VnaCBhbGwgb2YgdGhlIGtleXMgaW4gdGhlIG9iamVjdC5cblxuICAgICAgICAgICAgICAgIGZvciAoayBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHZhbHVlLCBrKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdiA9IHN0cihrLCB2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnRpYWwucHVzaChxdW90ZShrKSArIChnYXAgPyAnOiAnIDogJzonKSArIHYpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4vLyBKb2luIGFsbCBvZiB0aGUgbWVtYmVyIHRleHRzIHRvZ2V0aGVyLCBzZXBhcmF0ZWQgd2l0aCBjb21tYXMsXG4vLyBhbmQgd3JhcCB0aGVtIGluIGJyYWNlcy5cblxuICAgICAgICAgICAgdiA9IHBhcnRpYWwubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgICAgPyAne30nXG4gICAgICAgICAgICAgICAgOiBnYXBcbiAgICAgICAgICAgICAgICA/ICd7XFxuJyArIGdhcCArIHBhcnRpYWwuam9pbignLFxcbicgKyBnYXApICsgJ1xcbicgKyBtaW5kICsgJ30nXG4gICAgICAgICAgICAgICAgOiAneycgKyBwYXJ0aWFsLmpvaW4oJywnKSArICd9JztcbiAgICAgICAgICAgIGdhcCA9IG1pbmQ7XG4gICAgICAgICAgICByZXR1cm4gdjtcbiAgICAgICAgfVxuICAgIH1cblxuLy8gSWYgdGhlIEpTT04gb2JqZWN0IGRvZXMgbm90IHlldCBoYXZlIGEgc3RyaW5naWZ5IG1ldGhvZCwgZ2l2ZSBpdCBvbmUuXG5cbiAgICBpZiAodHlwZW9mIEpTT04uc3RyaW5naWZ5ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIEpTT04uc3RyaW5naWZ5ID0gZnVuY3Rpb24gKHZhbHVlLCByZXBsYWNlciwgc3BhY2UpIHtcblxuLy8gVGhlIHN0cmluZ2lmeSBtZXRob2QgdGFrZXMgYSB2YWx1ZSBhbmQgYW4gb3B0aW9uYWwgcmVwbGFjZXIsIGFuZCBhbiBvcHRpb25hbFxuLy8gc3BhY2UgcGFyYW1ldGVyLCBhbmQgcmV0dXJucyBhIEpTT04gdGV4dC4gVGhlIHJlcGxhY2VyIGNhbiBiZSBhIGZ1bmN0aW9uXG4vLyB0aGF0IGNhbiByZXBsYWNlIHZhbHVlcywgb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncyB0aGF0IHdpbGwgc2VsZWN0IHRoZSBrZXlzLlxuLy8gQSBkZWZhdWx0IHJlcGxhY2VyIG1ldGhvZCBjYW4gYmUgcHJvdmlkZWQuIFVzZSBvZiB0aGUgc3BhY2UgcGFyYW1ldGVyIGNhblxuLy8gcHJvZHVjZSB0ZXh0IHRoYXQgaXMgbW9yZSBlYXNpbHkgcmVhZGFibGUuXG5cbiAgICAgICAgICAgIHZhciBpO1xuICAgICAgICAgICAgZ2FwID0gJyc7XG4gICAgICAgICAgICBpbmRlbnQgPSAnJztcblxuLy8gSWYgdGhlIHNwYWNlIHBhcmFtZXRlciBpcyBhIG51bWJlciwgbWFrZSBhbiBpbmRlbnQgc3RyaW5nIGNvbnRhaW5pbmcgdGhhdFxuLy8gbWFueSBzcGFjZXMuXG5cbiAgICAgICAgICAgIGlmICh0eXBlb2Ygc3BhY2UgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICAgICAgZm9yIChpID0gMDsgaSA8IHNwYWNlOyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgaW5kZW50ICs9ICcgJztcbiAgICAgICAgICAgICAgICB9XG5cbi8vIElmIHRoZSBzcGFjZSBwYXJhbWV0ZXIgaXMgYSBzdHJpbmcsIGl0IHdpbGwgYmUgdXNlZCBhcyB0aGUgaW5kZW50IHN0cmluZy5cblxuICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2Ygc3BhY2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgaW5kZW50ID0gc3BhY2U7XG4gICAgICAgICAgICB9XG5cbi8vIElmIHRoZXJlIGlzIGEgcmVwbGFjZXIsIGl0IG11c3QgYmUgYSBmdW5jdGlvbiBvciBhbiBhcnJheS5cbi8vIE90aGVyd2lzZSwgdGhyb3cgYW4gZXJyb3IuXG5cbiAgICAgICAgICAgIHJlcCA9IHJlcGxhY2VyO1xuICAgICAgICAgICAgaWYgKHJlcGxhY2VyICYmIHR5cGVvZiByZXBsYWNlciAhPT0gJ2Z1bmN0aW9uJyAmJlxuICAgICAgICAgICAgICAgICAgICAodHlwZW9mIHJlcGxhY2VyICE9PSAnb2JqZWN0JyB8fFxuICAgICAgICAgICAgICAgICAgICB0eXBlb2YgcmVwbGFjZXIubGVuZ3RoICE9PSAnbnVtYmVyJykpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0pTT04uc3RyaW5naWZ5Jyk7XG4gICAgICAgICAgICB9XG5cbi8vIE1ha2UgYSBmYWtlIHJvb3Qgb2JqZWN0IGNvbnRhaW5pbmcgb3VyIHZhbHVlIHVuZGVyIHRoZSBrZXkgb2YgJycuXG4vLyBSZXR1cm4gdGhlIHJlc3VsdCBvZiBzdHJpbmdpZnlpbmcgdGhlIHZhbHVlLlxuXG4gICAgICAgICAgICByZXR1cm4gc3RyKCcnLCB7Jyc6IHZhbHVlfSk7XG4gICAgICAgIH07XG4gICAgfVxuXG5cbi8vIElmIHRoZSBKU09OIG9iamVjdCBkb2VzIG5vdCB5ZXQgaGF2ZSBhIHBhcnNlIG1ldGhvZCwgZ2l2ZSBpdCBvbmUuXG5cbiAgICBpZiAodHlwZW9mIEpTT04ucGFyc2UgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgSlNPTi5wYXJzZSA9IGZ1bmN0aW9uICh0ZXh0LCByZXZpdmVyKSB7XG5cbi8vIFRoZSBwYXJzZSBtZXRob2QgdGFrZXMgYSB0ZXh0IGFuZCBhbiBvcHRpb25hbCByZXZpdmVyIGZ1bmN0aW9uLCBhbmQgcmV0dXJuc1xuLy8gYSBKYXZhU2NyaXB0IHZhbHVlIGlmIHRoZSB0ZXh0IGlzIGEgdmFsaWQgSlNPTiB0ZXh0LlxuXG4gICAgICAgICAgICB2YXIgajtcblxuICAgICAgICAgICAgZnVuY3Rpb24gd2Fsayhob2xkZXIsIGtleSkge1xuXG4vLyBUaGUgd2FsayBtZXRob2QgaXMgdXNlZCB0byByZWN1cnNpdmVseSB3YWxrIHRoZSByZXN1bHRpbmcgc3RydWN0dXJlIHNvXG4vLyB0aGF0IG1vZGlmaWNhdGlvbnMgY2FuIGJlIG1hZGUuXG5cbiAgICAgICAgICAgICAgICB2YXIgaywgdiwgdmFsdWUgPSBob2xkZXJba2V5XTtcbiAgICAgICAgICAgICAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGsgaW4gdmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwodmFsdWUsIGspKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdiA9IHdhbGsodmFsdWUsIGspO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVba10gPSB2O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSB2YWx1ZVtrXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJldml2ZXIuY2FsbChob2xkZXIsIGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfVxuXG5cbi8vIFBhcnNpbmcgaGFwcGVucyBpbiBmb3VyIHN0YWdlcy4gSW4gdGhlIGZpcnN0IHN0YWdlLCB3ZSByZXBsYWNlIGNlcnRhaW5cbi8vIFVuaWNvZGUgY2hhcmFjdGVycyB3aXRoIGVzY2FwZSBzZXF1ZW5jZXMuIEphdmFTY3JpcHQgaGFuZGxlcyBtYW55IGNoYXJhY3RlcnNcbi8vIGluY29ycmVjdGx5LCBlaXRoZXIgc2lsZW50bHkgZGVsZXRpbmcgdGhlbSwgb3IgdHJlYXRpbmcgdGhlbSBhcyBsaW5lIGVuZGluZ3MuXG5cbiAgICAgICAgICAgIHRleHQgPSBTdHJpbmcodGV4dCk7XG4gICAgICAgICAgICBjeC5sYXN0SW5kZXggPSAwO1xuICAgICAgICAgICAgaWYgKGN4LnRlc3QodGV4dCkpIHtcbiAgICAgICAgICAgICAgICB0ZXh0ID0gdGV4dC5yZXBsYWNlKGN4LCBmdW5jdGlvbiAoYSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ1xcXFx1JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAoJzAwMDAnICsgYS5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTQpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4vLyBJbiB0aGUgc2Vjb25kIHN0YWdlLCB3ZSBydW4gdGhlIHRleHQgYWdhaW5zdCByZWd1bGFyIGV4cHJlc3Npb25zIHRoYXQgbG9va1xuLy8gZm9yIG5vbi1KU09OIHBhdHRlcm5zLiBXZSBhcmUgZXNwZWNpYWxseSBjb25jZXJuZWQgd2l0aCAnKCknIGFuZCAnbmV3J1xuLy8gYmVjYXVzZSB0aGV5IGNhbiBjYXVzZSBpbnZvY2F0aW9uLCBhbmQgJz0nIGJlY2F1c2UgaXQgY2FuIGNhdXNlIG11dGF0aW9uLlxuLy8gQnV0IGp1c3QgdG8gYmUgc2FmZSwgd2Ugd2FudCB0byByZWplY3QgYWxsIHVuZXhwZWN0ZWQgZm9ybXMuXG5cbi8vIFdlIHNwbGl0IHRoZSBzZWNvbmQgc3RhZ2UgaW50byA0IHJlZ2V4cCBvcGVyYXRpb25zIGluIG9yZGVyIHRvIHdvcmsgYXJvdW5kXG4vLyBjcmlwcGxpbmcgaW5lZmZpY2llbmNpZXMgaW4gSUUncyBhbmQgU2FmYXJpJ3MgcmVnZXhwIGVuZ2luZXMuIEZpcnN0IHdlXG4vLyByZXBsYWNlIHRoZSBKU09OIGJhY2tzbGFzaCBwYWlycyB3aXRoICdAJyAoYSBub24tSlNPTiBjaGFyYWN0ZXIpLiBTZWNvbmQsIHdlXG4vLyByZXBsYWNlIGFsbCBzaW1wbGUgdmFsdWUgdG9rZW5zIHdpdGggJ10nIGNoYXJhY3RlcnMuIFRoaXJkLCB3ZSBkZWxldGUgYWxsXG4vLyBvcGVuIGJyYWNrZXRzIHRoYXQgZm9sbG93IGEgY29sb24gb3IgY29tbWEgb3IgdGhhdCBiZWdpbiB0aGUgdGV4dC4gRmluYWxseSxcbi8vIHdlIGxvb2sgdG8gc2VlIHRoYXQgdGhlIHJlbWFpbmluZyBjaGFyYWN0ZXJzIGFyZSBvbmx5IHdoaXRlc3BhY2Ugb3IgJ10nIG9yXG4vLyAnLCcgb3IgJzonIG9yICd7JyBvciAnfScuIElmIHRoYXQgaXMgc28sIHRoZW4gdGhlIHRleHQgaXMgc2FmZSBmb3IgZXZhbC5cblxuICAgICAgICAgICAgaWYgKC9eW1xcXSw6e31cXHNdKiQvXG4gICAgICAgICAgICAgICAgICAgIC50ZXN0KHRleHQucmVwbGFjZSgvXFxcXCg/OltcIlxcXFxcXC9iZm5ydF18dVswLTlhLWZBLUZdezR9KS9nLCAnQCcpXG4gICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvXCJbXlwiXFxcXFxcblxccl0qXCJ8dHJ1ZXxmYWxzZXxudWxsfC0/XFxkKyg/OlxcLlxcZCopPyg/OltlRV1bK1xcLV0/XFxkKyk/L2csICddJylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8oPzpefDp8LCkoPzpcXHMqXFxbKSsvZywgJycpKSkge1xuXG4vLyBJbiB0aGUgdGhpcmQgc3RhZ2Ugd2UgdXNlIHRoZSBldmFsIGZ1bmN0aW9uIHRvIGNvbXBpbGUgdGhlIHRleHQgaW50byBhXG4vLyBKYXZhU2NyaXB0IHN0cnVjdHVyZS4gVGhlICd7JyBvcGVyYXRvciBpcyBzdWJqZWN0IHRvIGEgc3ludGFjdGljIGFtYmlndWl0eVxuLy8gaW4gSmF2YVNjcmlwdDogaXQgY2FuIGJlZ2luIGEgYmxvY2sgb3IgYW4gb2JqZWN0IGxpdGVyYWwuIFdlIHdyYXAgdGhlIHRleHRcbi8vIGluIHBhcmVucyB0byBlbGltaW5hdGUgdGhlIGFtYmlndWl0eS5cblxuICAgICAgICAgICAgICAgIGogPSBldmFsKCcoJyArIHRleHQgKyAnKScpO1xuXG4vLyBJbiB0aGUgb3B0aW9uYWwgZm91cnRoIHN0YWdlLCB3ZSByZWN1cnNpdmVseSB3YWxrIHRoZSBuZXcgc3RydWN0dXJlLCBwYXNzaW5nXG4vLyBlYWNoIG5hbWUvdmFsdWUgcGFpciB0byBhIHJldml2ZXIgZnVuY3Rpb24gZm9yIHBvc3NpYmxlIHRyYW5zZm9ybWF0aW9uLlxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiByZXZpdmVyID09PSAnZnVuY3Rpb24nXG4gICAgICAgICAgICAgICAgICAgID8gd2Fsayh7Jyc6IGp9LCAnJylcbiAgICAgICAgICAgICAgICAgICAgOiBqO1xuICAgICAgICAgICAgfVxuXG4vLyBJZiB0aGUgdGV4dCBpcyBub3QgSlNPTiBwYXJzZWFibGUsIHRoZW4gYSBTeW50YXhFcnJvciBpcyB0aHJvd24uXG5cbiAgICAgICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcignSlNPTi5wYXJzZScpO1xuICAgICAgICB9O1xuICAgIH1cbn0oKSk7XG5cbm1vZHVsZS5leHBvcnRzID0gSlNPTiIsIi8qKlxuICogTW9kdWxlIGRlcGVuZGVuY2llc1xuICovXG5cbnZhciBkZWJ1ZyA9IHJlcXVpcmUoJ2RlYnVnJykoJ2pzb25wJyk7XG5cbi8qKlxuICogTW9kdWxlIGV4cG9ydHMuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBqc29ucDtcblxuLyoqXG4gKiBDYWxsYmFjayBpbmRleC5cbiAqL1xuXG52YXIgY291bnQgPSAwO1xuXG4vKipcbiAqIE5vb3AgZnVuY3Rpb24uXG4gKi9cblxuZnVuY3Rpb24gbm9vcCgpe31cblxuLyoqXG4gKiBKU09OUCBoYW5kbGVyXG4gKlxuICogT3B0aW9uczpcbiAqICAtIHBhcmFtIHtTdHJpbmd9IHFzIHBhcmFtZXRlciAoYGNhbGxiYWNrYClcbiAqICAtIHRpbWVvdXQge051bWJlcn0gaG93IGxvbmcgYWZ0ZXIgYSB0aW1lb3V0IGVycm9yIGlzIGVtaXR0ZWQgKGA2MDAwMGApXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHVybFxuICogQHBhcmFtIHtPYmplY3R8RnVuY3Rpb259IG9wdGlvbmFsIG9wdGlvbnMgLyBjYWxsYmFja1xuICogQHBhcmFtIHtGdW5jdGlvbn0gb3B0aW9uYWwgY2FsbGJhY2tcbiAqL1xuXG5mdW5jdGlvbiBqc29ucCh1cmwsIG9wdHMsIGZuKXtcbiAgaWYgKCdmdW5jdGlvbicgPT0gdHlwZW9mIG9wdHMpIHtcbiAgICBmbiA9IG9wdHM7XG4gICAgb3B0cyA9IHt9O1xuICB9XG4gIGlmICghb3B0cykgb3B0cyA9IHt9O1xuXG4gIHZhciBwcmVmaXggPSBvcHRzLnByZWZpeCB8fCAnX19qcCc7XG4gIHZhciBwYXJhbSA9IG9wdHMucGFyYW0gfHwgJ2NhbGxiYWNrJztcbiAgdmFyIHRpbWVvdXQgPSBudWxsICE9IG9wdHMudGltZW91dCA/IG9wdHMudGltZW91dCA6IDYwMDAwO1xuICB2YXIgZW5jID0gZW5jb2RlVVJJQ29tcG9uZW50O1xuICB2YXIgdGFyZ2V0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3NjcmlwdCcpWzBdIHx8IGRvY3VtZW50LmhlYWQ7XG4gIHZhciBzY3JpcHQ7XG4gIHZhciB0aW1lcjtcblxuICAvLyBnZW5lcmF0ZSBhIHVuaXF1ZSBpZCBmb3IgdGhpcyByZXF1ZXN0XG4gIHZhciBpZCA9IHByZWZpeCArIChjb3VudCsrKTtcblxuICBpZiAodGltZW91dCkge1xuICAgIHRpbWVyID0gc2V0VGltZW91dChmdW5jdGlvbigpe1xuICAgICAgY2xlYW51cCgpO1xuICAgICAgaWYgKGZuKSBmbihuZXcgRXJyb3IoJ1RpbWVvdXQnKSk7XG4gICAgfSwgdGltZW91dCk7XG4gIH1cblxuICBmdW5jdGlvbiBjbGVhbnVwKCl7XG4gICAgc2NyaXB0LnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoc2NyaXB0KTtcbiAgICB3aW5kb3dbaWRdID0gbm9vcDtcbiAgfVxuXG4gIHdpbmRvd1tpZF0gPSBmdW5jdGlvbihkYXRhKXtcbiAgICBkZWJ1ZygnanNvbnAgZ290JywgZGF0YSk7XG4gICAgaWYgKHRpbWVyKSBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgIGNsZWFudXAoKTtcbiAgICBpZiAoZm4pIGZuKG51bGwsIGRhdGEpO1xuICB9O1xuXG4gIC8vIGFkZCBxcyBjb21wb25lbnRcbiAgdXJsICs9ICh+dXJsLmluZGV4T2YoJz8nKSA/ICcmJyA6ICc/JykgKyBwYXJhbSArICc9JyArIGVuYyhpZCk7XG4gIHVybCA9IHVybC5yZXBsYWNlKCc/JicsICc/Jyk7XG5cbiAgZGVidWcoJ2pzb25wIHJlcSBcIiVzXCInLCB1cmwpO1xuXG4gIC8vIGNyZWF0ZSBzY3JpcHRcbiAgc2NyaXB0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gIHNjcmlwdC5zcmMgPSB1cmw7XG4gIHRhcmdldC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShzY3JpcHQsIHRhcmdldCk7XG59XG4iLCIvKipcbiAqIE9iamVjdCN0b1N0cmluZygpIHJlZiBmb3Igc3RyaW5naWZ5KCkuXG4gKi9cblxudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBPYmplY3QjaGFzT3duUHJvcGVydHkgcmVmXG4gKi9cblxudmFyIGhhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcblxuLyoqXG4gKiBBcnJheSNpbmRleE9mIHNoaW0uXG4gKi9cblxudmFyIGluZGV4T2YgPSB0eXBlb2YgQXJyYXkucHJvdG90eXBlLmluZGV4T2YgPT09ICdmdW5jdGlvbidcbiAgPyBmdW5jdGlvbihhcnIsIGVsKSB7IHJldHVybiBhcnIuaW5kZXhPZihlbCk7IH1cbiAgOiBmdW5jdGlvbihhcnIsIGVsKSB7XG4gICAgICBpZiAodHlwZW9mIGFyciA9PSAnc3RyaW5nJyAmJiB0eXBlb2YgXCJhXCJbMF0gPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgYXJyID0gYXJyLnNwbGl0KCcnKTtcbiAgICAgIH1cbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmIChhcnJbaV0gPT09IGVsKSByZXR1cm4gaTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAtMTtcbiAgICB9O1xuXG4vKipcbiAqIEFycmF5LmlzQXJyYXkgc2hpbS5cbiAqL1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24oYXJyKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKGFycikgPT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5cbi8qKlxuICogT2JqZWN0LmtleXMgc2hpbS5cbiAqL1xuXG52YXIgb2JqZWN0S2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uKG9iaikge1xuICB2YXIgcmV0ID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgIHJldC5wdXNoKGtleSk7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXQ7XG59O1xuXG4vKipcbiAqIEFycmF5I2ZvckVhY2ggc2hpbS5cbiAqL1xuXG52YXIgZm9yRWFjaCA9IHR5cGVvZiBBcnJheS5wcm90b3R5cGUuZm9yRWFjaCA9PT0gJ2Z1bmN0aW9uJ1xuICA/IGZ1bmN0aW9uKGFyciwgZm4pIHsgcmV0dXJuIGFyci5mb3JFYWNoKGZuKTsgfVxuICA6IGZ1bmN0aW9uKGFyciwgZm4pIHtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyLmxlbmd0aDsgaSsrKSBmbihhcnJbaV0pO1xuICAgIH07XG5cbi8qKlxuICogQXJyYXkjcmVkdWNlIHNoaW0uXG4gKi9cblxudmFyIHJlZHVjZSA9IGZ1bmN0aW9uKGFyciwgZm4sIGluaXRpYWwpIHtcbiAgaWYgKHR5cGVvZiBhcnIucmVkdWNlID09PSAnZnVuY3Rpb24nKSByZXR1cm4gYXJyLnJlZHVjZShmbiwgaW5pdGlhbCk7XG4gIHZhciByZXMgPSBpbml0aWFsO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykgcmVzID0gZm4ocmVzLCBhcnJbaV0pO1xuICByZXR1cm4gcmVzO1xufTtcblxuLyoqXG4gKiBDYWNoZSBub24taW50ZWdlciB0ZXN0IHJlZ2V4cC5cbiAqL1xuXG52YXIgaXNpbnQgPSAvXlswLTldKyQvO1xuXG5mdW5jdGlvbiBwcm9tb3RlKHBhcmVudCwga2V5KSB7XG4gIGlmIChwYXJlbnRba2V5XS5sZW5ndGggPT0gMCkgcmV0dXJuIHBhcmVudFtrZXldID0ge31cbiAgdmFyIHQgPSB7fTtcbiAgZm9yICh2YXIgaSBpbiBwYXJlbnRba2V5XSkge1xuICAgIGlmIChoYXNPd25Qcm9wZXJ0eS5jYWxsKHBhcmVudFtrZXldLCBpKSkge1xuICAgICAgdFtpXSA9IHBhcmVudFtrZXldW2ldO1xuICAgIH1cbiAgfVxuICBwYXJlbnRba2V5XSA9IHQ7XG4gIHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBwYXJzZShwYXJ0cywgcGFyZW50LCBrZXksIHZhbCkge1xuICB2YXIgcGFydCA9IHBhcnRzLnNoaWZ0KCk7XG5cbiAgLy8gaWxsZWdhbFxuICBpZiAoaGFzT3duUHJvcGVydHkuY2FsbChPYmplY3QucHJvdG90eXBlLCBrZXkpKSByZXR1cm47XG5cbiAgLy8gZW5kXG4gIGlmICghcGFydCkge1xuICAgIGlmIChpc0FycmF5KHBhcmVudFtrZXldKSkge1xuICAgICAgcGFyZW50W2tleV0ucHVzaCh2YWwpO1xuICAgIH0gZWxzZSBpZiAoJ29iamVjdCcgPT0gdHlwZW9mIHBhcmVudFtrZXldKSB7XG4gICAgICBwYXJlbnRba2V5XSA9IHZhbDtcbiAgICB9IGVsc2UgaWYgKCd1bmRlZmluZWQnID09IHR5cGVvZiBwYXJlbnRba2V5XSkge1xuICAgICAgcGFyZW50W2tleV0gPSB2YWw7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBhcmVudFtrZXldID0gW3BhcmVudFtrZXldLCB2YWxdO1xuICAgIH1cbiAgICAvLyBhcnJheVxuICB9IGVsc2Uge1xuICAgIHZhciBvYmogPSBwYXJlbnRba2V5XSA9IHBhcmVudFtrZXldIHx8IFtdO1xuICAgIGlmICgnXScgPT0gcGFydCkge1xuICAgICAgaWYgKGlzQXJyYXkob2JqKSkge1xuICAgICAgICBpZiAoJycgIT0gdmFsKSBvYmoucHVzaCh2YWwpO1xuICAgICAgfSBlbHNlIGlmICgnb2JqZWN0JyA9PSB0eXBlb2Ygb2JqKSB7XG4gICAgICAgIG9ialtvYmplY3RLZXlzKG9iaikubGVuZ3RoXSA9IHZhbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9iaiA9IHBhcmVudFtrZXldID0gW3BhcmVudFtrZXldLCB2YWxdO1xuICAgICAgfVxuICAgICAgLy8gcHJvcFxuICAgIH0gZWxzZSBpZiAofmluZGV4T2YocGFydCwgJ10nKSkge1xuICAgICAgcGFydCA9IHBhcnQuc3Vic3RyKDAsIHBhcnQubGVuZ3RoIC0gMSk7XG4gICAgICBpZiAoIWlzaW50LnRlc3QocGFydCkgJiYgaXNBcnJheShvYmopKSBvYmogPSBwcm9tb3RlKHBhcmVudCwga2V5KTtcbiAgICAgIHBhcnNlKHBhcnRzLCBvYmosIHBhcnQsIHZhbCk7XG4gICAgICAvLyBrZXlcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFpc2ludC50ZXN0KHBhcnQpICYmIGlzQXJyYXkob2JqKSkgb2JqID0gcHJvbW90ZShwYXJlbnQsIGtleSk7XG4gICAgICBwYXJzZShwYXJ0cywgb2JqLCBwYXJ0LCB2YWwpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIE1lcmdlIHBhcmVudCBrZXkvdmFsIHBhaXIuXG4gKi9cblxuZnVuY3Rpb24gbWVyZ2UocGFyZW50LCBrZXksIHZhbCl7XG4gIGlmICh+aW5kZXhPZihrZXksICddJykpIHtcbiAgICB2YXIgcGFydHMgPSBrZXkuc3BsaXQoJ1snKVxuICAgICAgLCBsZW4gPSBwYXJ0cy5sZW5ndGhcbiAgICAgICwgbGFzdCA9IGxlbiAtIDE7XG4gICAgcGFyc2UocGFydHMsIHBhcmVudCwgJ2Jhc2UnLCB2YWwpO1xuICAgIC8vIG9wdGltaXplXG4gIH0gZWxzZSB7XG4gICAgaWYgKCFpc2ludC50ZXN0KGtleSkgJiYgaXNBcnJheShwYXJlbnQuYmFzZSkpIHtcbiAgICAgIHZhciB0ID0ge307XG4gICAgICBmb3IgKHZhciBrIGluIHBhcmVudC5iYXNlKSB0W2tdID0gcGFyZW50LmJhc2Vba107XG4gICAgICBwYXJlbnQuYmFzZSA9IHQ7XG4gICAgfVxuICAgIHNldChwYXJlbnQuYmFzZSwga2V5LCB2YWwpO1xuICB9XG5cbiAgcmV0dXJuIHBhcmVudDtcbn1cblxuLyoqXG4gKiBDb21wYWN0IHNwYXJzZSBhcnJheXMuXG4gKi9cblxuZnVuY3Rpb24gY29tcGFjdChvYmopIHtcbiAgaWYgKCdvYmplY3QnICE9IHR5cGVvZiBvYmopIHJldHVybiBvYmo7XG5cbiAgaWYgKGlzQXJyYXkob2JqKSkge1xuICAgIHZhciByZXQgPSBbXTtcblxuICAgIGZvciAodmFyIGkgaW4gb2JqKSB7XG4gICAgICBpZiAoaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGkpKSB7XG4gICAgICAgIHJldC5wdXNoKG9ialtpXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJldDtcbiAgfVxuXG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICBvYmpba2V5XSA9IGNvbXBhY3Qob2JqW2tleV0pO1xuICB9XG5cbiAgcmV0dXJuIG9iajtcbn1cblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gb2JqLlxuICovXG5cbmZ1bmN0aW9uIHBhcnNlT2JqZWN0KG9iail7XG4gIHZhciByZXQgPSB7IGJhc2U6IHt9IH07XG5cbiAgZm9yRWFjaChvYmplY3RLZXlzKG9iaiksIGZ1bmN0aW9uKG5hbWUpe1xuICAgIG1lcmdlKHJldCwgbmFtZSwgb2JqW25hbWVdKTtcbiAgfSk7XG5cbiAgcmV0dXJuIGNvbXBhY3QocmV0LmJhc2UpO1xufVxuXG4vKipcbiAqIFBhcnNlIHRoZSBnaXZlbiBzdHIuXG4gKi9cblxuZnVuY3Rpb24gcGFyc2VTdHJpbmcoc3RyLCBvcHRpb25zKXtcbiAgdmFyIHJldCA9IHJlZHVjZShTdHJpbmcoc3RyKS5zcGxpdChvcHRpb25zLnNlcGFyYXRvciksIGZ1bmN0aW9uKHJldCwgcGFpcil7XG4gICAgdmFyIGVxbCA9IGluZGV4T2YocGFpciwgJz0nKVxuICAgICAgLCBicmFjZSA9IGxhc3RCcmFjZUluS2V5KHBhaXIpXG4gICAgICAsIGtleSA9IHBhaXIuc3Vic3RyKDAsIGJyYWNlIHx8IGVxbClcbiAgICAgICwgdmFsID0gcGFpci5zdWJzdHIoYnJhY2UgfHwgZXFsLCBwYWlyLmxlbmd0aClcbiAgICAgICwgdmFsID0gdmFsLnN1YnN0cihpbmRleE9mKHZhbCwgJz0nKSArIDEsIHZhbC5sZW5ndGgpO1xuXG4gICAgLy8gP2Zvb1xuICAgIGlmICgnJyA9PSBrZXkpIGtleSA9IHBhaXIsIHZhbCA9ICcnO1xuICAgIGlmICgnJyA9PSBrZXkpIHJldHVybiByZXQ7XG5cbiAgICByZXR1cm4gbWVyZ2UocmV0LCBkZWNvZGUoa2V5KSwgZGVjb2RlKHZhbCkpO1xuICB9LCB7IGJhc2U6IHt9IH0pLmJhc2U7XG5cbiAgcmV0dXJuIGNvbXBhY3QocmV0KTtcbn1cblxuLyoqXG4gKiBQYXJzZSB0aGUgZ2l2ZW4gcXVlcnkgYHN0cmAgb3IgYG9iamAsIHJldHVybmluZyBhbiBvYmplY3QuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0ciB8IHtPYmplY3R9IG9ialxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLnBhcnNlID0gZnVuY3Rpb24oc3RyLCBvcHRpb25zKXtcbiAgaWYgKG51bGwgPT0gc3RyIHx8ICcnID09IHN0cikgcmV0dXJuIHt9O1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgb3B0aW9ucy5zZXBhcmF0b3IgPSBvcHRpb25zLnNlcGFyYXRvciB8fCAnJic7XG4gIHJldHVybiAnb2JqZWN0JyA9PSB0eXBlb2Ygc3RyXG4gICAgPyBwYXJzZU9iamVjdChzdHIpXG4gICAgOiBwYXJzZVN0cmluZyhzdHIsIG9wdGlvbnMpO1xufTtcblxuLyoqXG4gKiBUdXJuIHRoZSBnaXZlbiBgb2JqYCBpbnRvIGEgcXVlcnkgc3RyaW5nXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG52YXIgc3RyaW5naWZ5ID0gZXhwb3J0cy5zdHJpbmdpZnkgPSBmdW5jdGlvbihvYmosIHByZWZpeCkge1xuICBpZiAoaXNBcnJheShvYmopKSB7XG4gICAgcmV0dXJuIHN0cmluZ2lmeUFycmF5KG9iaiwgcHJlZml4KTtcbiAgfSBlbHNlIGlmICgnW29iamVjdCBPYmplY3RdJyA9PSB0b1N0cmluZy5jYWxsKG9iaikpIHtcbiAgICByZXR1cm4gc3RyaW5naWZ5T2JqZWN0KG9iaiwgcHJlZml4KTtcbiAgfSBlbHNlIGlmICgnc3RyaW5nJyA9PSB0eXBlb2Ygb2JqKSB7XG4gICAgcmV0dXJuIHN0cmluZ2lmeVN0cmluZyhvYmosIHByZWZpeCk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHByZWZpeCArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudChTdHJpbmcob2JqKSk7XG4gIH1cbn07XG5cbi8qKlxuICogU3RyaW5naWZ5IHRoZSBnaXZlbiBgc3RyYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcGFyYW0ge1N0cmluZ30gcHJlZml4XG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBzdHJpbmdpZnlTdHJpbmcoc3RyLCBwcmVmaXgpIHtcbiAgaWYgKCFwcmVmaXgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0cmluZ2lmeSBleHBlY3RzIGFuIG9iamVjdCcpO1xuICByZXR1cm4gcHJlZml4ICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHN0cik7XG59XG5cbi8qKlxuICogU3RyaW5naWZ5IHRoZSBnaXZlbiBgYXJyYC5cbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBhcnJcbiAqIEBwYXJhbSB7U3RyaW5nfSBwcmVmaXhcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHN0cmluZ2lmeUFycmF5KGFyciwgcHJlZml4KSB7XG4gIHZhciByZXQgPSBbXTtcbiAgaWYgKCFwcmVmaXgpIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0cmluZ2lmeSBleHBlY3RzIGFuIG9iamVjdCcpO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGFyci5sZW5ndGg7IGkrKykge1xuICAgIHJldC5wdXNoKHN0cmluZ2lmeShhcnJbaV0sIHByZWZpeCArICdbJyArIGkgKyAnXScpKTtcbiAgfVxuICByZXR1cm4gcmV0LmpvaW4oJyYnKTtcbn1cblxuLyoqXG4gKiBTdHJpbmdpZnkgdGhlIGdpdmVuIGBvYmpgLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEBwYXJhbSB7U3RyaW5nfSBwcmVmaXhcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIHN0cmluZ2lmeU9iamVjdChvYmosIHByZWZpeCkge1xuICB2YXIgcmV0ID0gW11cbiAgICAsIGtleXMgPSBvYmplY3RLZXlzKG9iailcbiAgICAsIGtleTtcblxuICBmb3IgKHZhciBpID0gMCwgbGVuID0ga2V5cy5sZW5ndGg7IGkgPCBsZW47ICsraSkge1xuICAgIGtleSA9IGtleXNbaV07XG4gICAgaWYgKCcnID09IGtleSkgY29udGludWU7XG4gICAgaWYgKG51bGwgPT0gb2JqW2tleV0pIHtcbiAgICAgIHJldC5wdXNoKGVuY29kZVVSSUNvbXBvbmVudChrZXkpICsgJz0nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0LnB1c2goc3RyaW5naWZ5KG9ialtrZXldLCBwcmVmaXhcbiAgICAgICAgPyBwcmVmaXggKyAnWycgKyBlbmNvZGVVUklDb21wb25lbnQoa2V5KSArICddJ1xuICAgICAgICA6IGVuY29kZVVSSUNvbXBvbmVudChrZXkpKSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJldC5qb2luKCcmJyk7XG59XG5cbi8qKlxuICogU2V0IGBvYmpgJ3MgYGtleWAgdG8gYHZhbGAgcmVzcGVjdGluZ1xuICogdGhlIHdlaXJkIGFuZCB3b25kZXJmdWwgc3ludGF4IG9mIGEgcXMsXG4gKiB3aGVyZSBcImZvbz1iYXImZm9vPWJhelwiIGJlY29tZXMgYW4gYXJyYXkuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9ialxuICogQHBhcmFtIHtTdHJpbmd9IGtleVxuICogQHBhcmFtIHtTdHJpbmd9IHZhbFxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gc2V0KG9iaiwga2V5LCB2YWwpIHtcbiAgdmFyIHYgPSBvYmpba2V5XTtcbiAgaWYgKGhhc093blByb3BlcnR5LmNhbGwoT2JqZWN0LnByb3RvdHlwZSwga2V5KSkgcmV0dXJuO1xuICBpZiAodW5kZWZpbmVkID09PSB2KSB7XG4gICAgb2JqW2tleV0gPSB2YWw7XG4gIH0gZWxzZSBpZiAoaXNBcnJheSh2KSkge1xuICAgIHYucHVzaCh2YWwpO1xuICB9IGVsc2Uge1xuICAgIG9ialtrZXldID0gW3YsIHZhbF07XG4gIH1cbn1cblxuLyoqXG4gKiBMb2NhdGUgbGFzdCBicmFjZSBpbiBgc3RyYCB3aXRoaW4gdGhlIGtleS5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyXG4gKiBAcmV0dXJuIHtOdW1iZXJ9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBsYXN0QnJhY2VJbktleShzdHIpIHtcbiAgdmFyIGxlbiA9IHN0ci5sZW5ndGhcbiAgICAsIGJyYWNlXG4gICAgLCBjO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgKytpKSB7XG4gICAgYyA9IHN0cltpXTtcbiAgICBpZiAoJ10nID09IGMpIGJyYWNlID0gZmFsc2U7XG4gICAgaWYgKCdbJyA9PSBjKSBicmFjZSA9IHRydWU7XG4gICAgaWYgKCc9JyA9PSBjICYmICFicmFjZSkgcmV0dXJuIGk7XG4gIH1cbn1cblxuLyoqXG4gKiBEZWNvZGUgYHN0cmAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwcml2YXRlXG4gKi9cblxuZnVuY3Rpb24gZGVjb2RlKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyLnJlcGxhY2UoL1xcKy9nLCAnICcpKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIHN0cjtcbiAgfVxufVxuIiwiLyohXG4gICogUmVxd2VzdCEgQSBnZW5lcmFsIHB1cnBvc2UgWEhSIGNvbm5lY3Rpb24gbWFuYWdlclxuICAqIGxpY2Vuc2UgTUlUIChjKSBEdXN0aW4gRGlheiAyMDE0XG4gICogaHR0cHM6Ly9naXRodWIuY29tL2RlZC9yZXF3ZXN0XG4gICovXG5cbiFmdW5jdGlvbiAobmFtZSwgY29udGV4dCwgZGVmaW5pdGlvbikge1xuICBpZiAodHlwZW9mIG1vZHVsZSAhPSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cykgbW9kdWxlLmV4cG9ydHMgPSBkZWZpbml0aW9uKClcbiAgZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIGRlZmluZShkZWZpbml0aW9uKVxuICBlbHNlIGNvbnRleHRbbmFtZV0gPSBkZWZpbml0aW9uKClcbn0oJ3JlcXdlc3QnLCB0aGlzLCBmdW5jdGlvbiAoKSB7XG5cbiAgdmFyIHdpbiA9IHdpbmRvd1xuICAgICwgZG9jID0gZG9jdW1lbnRcbiAgICAsIGh0dHBzUmUgPSAvXmh0dHAvXG4gICAgLCBwcm90b2NvbFJlID0gLyheXFx3Kyk6XFwvXFwvL1xuICAgICwgdHdvSHVuZG8gPSAvXigyMFxcZHwxMjIzKSQvIC8vaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy8xMDA0Njk3Mi9tc2llLXJldHVybnMtc3RhdHVzLWNvZGUtb2YtMTIyMy1mb3ItYWpheC1yZXF1ZXN0XG4gICAgLCBieVRhZyA9ICdnZXRFbGVtZW50c0J5VGFnTmFtZSdcbiAgICAsIHJlYWR5U3RhdGUgPSAncmVhZHlTdGF0ZSdcbiAgICAsIGNvbnRlbnRUeXBlID0gJ0NvbnRlbnQtVHlwZSdcbiAgICAsIHJlcXVlc3RlZFdpdGggPSAnWC1SZXF1ZXN0ZWQtV2l0aCdcbiAgICAsIGhlYWQgPSBkb2NbYnlUYWddKCdoZWFkJylbMF1cbiAgICAsIHVuaXFpZCA9IDBcbiAgICAsIGNhbGxiYWNrUHJlZml4ID0gJ3JlcXdlc3RfJyArICgrbmV3IERhdGUoKSlcbiAgICAsIGxhc3RWYWx1ZSAvLyBkYXRhIHN0b3JlZCBieSB0aGUgbW9zdCByZWNlbnQgSlNPTlAgY2FsbGJhY2tcbiAgICAsIHhtbEh0dHBSZXF1ZXN0ID0gJ1hNTEh0dHBSZXF1ZXN0J1xuICAgICwgeERvbWFpblJlcXVlc3QgPSAnWERvbWFpblJlcXVlc3QnXG4gICAgLCBub29wID0gZnVuY3Rpb24gKCkge31cblxuICAgICwgaXNBcnJheSA9IHR5cGVvZiBBcnJheS5pc0FycmF5ID09ICdmdW5jdGlvbidcbiAgICAgICAgPyBBcnJheS5pc0FycmF5XG4gICAgICAgIDogZnVuY3Rpb24gKGEpIHtcbiAgICAgICAgICAgIHJldHVybiBhIGluc3RhbmNlb2YgQXJyYXlcbiAgICAgICAgICB9XG5cbiAgICAsIGRlZmF1bHRIZWFkZXJzID0ge1xuICAgICAgICAgICdjb250ZW50VHlwZSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXG4gICAgICAgICwgJ3JlcXVlc3RlZFdpdGgnOiB4bWxIdHRwUmVxdWVzdFxuICAgICAgICAsICdhY2NlcHQnOiB7XG4gICAgICAgICAgICAgICcqJzogICd0ZXh0L2phdmFzY3JpcHQsIHRleHQvaHRtbCwgYXBwbGljYXRpb24veG1sLCB0ZXh0L3htbCwgKi8qJ1xuICAgICAgICAgICAgLCAneG1sJzogICdhcHBsaWNhdGlvbi94bWwsIHRleHQveG1sJ1xuICAgICAgICAgICAgLCAnaHRtbCc6ICd0ZXh0L2h0bWwnXG4gICAgICAgICAgICAsICd0ZXh0JzogJ3RleHQvcGxhaW4nXG4gICAgICAgICAgICAsICdqc29uJzogJ2FwcGxpY2F0aW9uL2pzb24sIHRleHQvamF2YXNjcmlwdCdcbiAgICAgICAgICAgICwgJ2pzJzogICAnYXBwbGljYXRpb24vamF2YXNjcmlwdCwgdGV4dC9qYXZhc2NyaXB0J1xuICAgICAgICAgIH1cbiAgICAgIH1cblxuICAgICwgeGhyID0gZnVuY3Rpb24obykge1xuICAgICAgICAvLyBpcyBpdCB4LWRvbWFpblxuICAgICAgICBpZiAob1snY3Jvc3NPcmlnaW4nXSA9PT0gdHJ1ZSkge1xuICAgICAgICAgIHZhciB4aHIgPSB3aW5beG1sSHR0cFJlcXVlc3RdID8gbmV3IFhNTEh0dHBSZXF1ZXN0KCkgOiBudWxsXG4gICAgICAgICAgaWYgKHhociAmJiAnd2l0aENyZWRlbnRpYWxzJyBpbiB4aHIpIHtcbiAgICAgICAgICAgIHJldHVybiB4aHJcbiAgICAgICAgICB9IGVsc2UgaWYgKHdpblt4RG9tYWluUmVxdWVzdF0pIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgWERvbWFpblJlcXVlc3QoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Jyb3dzZXIgZG9lcyBub3Qgc3VwcG9ydCBjcm9zcy1vcmlnaW4gcmVxdWVzdHMnKVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh3aW5beG1sSHR0cFJlcXVlc3RdKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBYTUxIdHRwUmVxdWVzdCgpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBBY3RpdmVYT2JqZWN0KCdNaWNyb3NvZnQuWE1MSFRUUCcpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAsIGdsb2JhbFNldHVwT3B0aW9ucyA9IHtcbiAgICAgICAgZGF0YUZpbHRlcjogZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgICAgICByZXR1cm4gZGF0YVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgZnVuY3Rpb24gc3VjY2VlZChyKSB7XG4gICAgdmFyIHByb3RvY29sID0gcHJvdG9jb2xSZS5leGVjKHIudXJsKTtcbiAgICBwcm90b2NvbCA9IChwcm90b2NvbCAmJiBwcm90b2NvbFsxXSkgfHwgd2luZG93LmxvY2F0aW9uLnByb3RvY29sO1xuICAgIHJldHVybiBodHRwc1JlLnRlc3QocHJvdG9jb2wpID8gdHdvSHVuZG8udGVzdChyLnJlcXVlc3Quc3RhdHVzKSA6ICEhci5yZXF1ZXN0LnJlc3BvbnNlO1xuICB9XG5cbiAgZnVuY3Rpb24gaGFuZGxlUmVhZHlTdGF0ZShyLCBzdWNjZXNzLCBlcnJvcikge1xuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAvLyB1c2UgX2Fib3J0ZWQgdG8gbWl0aWdhdGUgYWdhaW5zdCBJRSBlcnIgYzAwYzAyM2ZcbiAgICAgIC8vIChjYW4ndCByZWFkIHByb3BzIG9uIGFib3J0ZWQgcmVxdWVzdCBvYmplY3RzKVxuICAgICAgaWYgKHIuX2Fib3J0ZWQpIHJldHVybiBlcnJvcihyLnJlcXVlc3QpXG4gICAgICBpZiAoci5fdGltZWRPdXQpIHJldHVybiBlcnJvcihyLnJlcXVlc3QsICdSZXF1ZXN0IGlzIGFib3J0ZWQ6IHRpbWVvdXQnKVxuICAgICAgaWYgKHIucmVxdWVzdCAmJiByLnJlcXVlc3RbcmVhZHlTdGF0ZV0gPT0gNCkge1xuICAgICAgICByLnJlcXVlc3Qub25yZWFkeXN0YXRlY2hhbmdlID0gbm9vcFxuICAgICAgICBpZiAoc3VjY2VlZChyKSkgc3VjY2VzcyhyLnJlcXVlc3QpXG4gICAgICAgIGVsc2VcbiAgICAgICAgICBlcnJvcihyLnJlcXVlc3QpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gc2V0SGVhZGVycyhodHRwLCBvKSB7XG4gICAgdmFyIGhlYWRlcnMgPSBvWydoZWFkZXJzJ10gfHwge31cbiAgICAgICwgaFxuXG4gICAgaGVhZGVyc1snQWNjZXB0J10gPSBoZWFkZXJzWydBY2NlcHQnXVxuICAgICAgfHwgZGVmYXVsdEhlYWRlcnNbJ2FjY2VwdCddW29bJ3R5cGUnXV1cbiAgICAgIHx8IGRlZmF1bHRIZWFkZXJzWydhY2NlcHQnXVsnKiddXG5cbiAgICB2YXIgaXNBRm9ybURhdGEgPSB0eXBlb2YgRm9ybURhdGEgPT09ICdmdW5jdGlvbicgJiYgKG9bJ2RhdGEnXSBpbnN0YW5jZW9mIEZvcm1EYXRhKTtcbiAgICAvLyBicmVha3MgY3Jvc3Mtb3JpZ2luIHJlcXVlc3RzIHdpdGggbGVnYWN5IGJyb3dzZXJzXG4gICAgaWYgKCFvWydjcm9zc09yaWdpbiddICYmICFoZWFkZXJzW3JlcXVlc3RlZFdpdGhdKSBoZWFkZXJzW3JlcXVlc3RlZFdpdGhdID0gZGVmYXVsdEhlYWRlcnNbJ3JlcXVlc3RlZFdpdGgnXVxuICAgIGlmICghaGVhZGVyc1tjb250ZW50VHlwZV0gJiYgIWlzQUZvcm1EYXRhKSBoZWFkZXJzW2NvbnRlbnRUeXBlXSA9IG9bJ2NvbnRlbnRUeXBlJ10gfHwgZGVmYXVsdEhlYWRlcnNbJ2NvbnRlbnRUeXBlJ11cbiAgICBmb3IgKGggaW4gaGVhZGVycylcbiAgICAgIGhlYWRlcnMuaGFzT3duUHJvcGVydHkoaCkgJiYgJ3NldFJlcXVlc3RIZWFkZXInIGluIGh0dHAgJiYgaHR0cC5zZXRSZXF1ZXN0SGVhZGVyKGgsIGhlYWRlcnNbaF0pXG4gIH1cblxuICBmdW5jdGlvbiBzZXRDcmVkZW50aWFscyhodHRwLCBvKSB7XG4gICAgaWYgKHR5cGVvZiBvWyd3aXRoQ3JlZGVudGlhbHMnXSAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIGh0dHAud2l0aENyZWRlbnRpYWxzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgaHR0cC53aXRoQ3JlZGVudGlhbHMgPSAhIW9bJ3dpdGhDcmVkZW50aWFscyddXG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZ2VuZXJhbENhbGxiYWNrKGRhdGEpIHtcbiAgICBsYXN0VmFsdWUgPSBkYXRhXG4gIH1cblxuICBmdW5jdGlvbiB1cmxhcHBlbmQgKHVybCwgcykge1xuICAgIHJldHVybiB1cmwgKyAoL1xcPy8udGVzdCh1cmwpID8gJyYnIDogJz8nKSArIHNcbiAgfVxuXG4gIGZ1bmN0aW9uIGhhbmRsZUpzb25wKG8sIGZuLCBlcnIsIHVybCkge1xuICAgIHZhciByZXFJZCA9IHVuaXFpZCsrXG4gICAgICAsIGNia2V5ID0gb1snanNvbnBDYWxsYmFjayddIHx8ICdjYWxsYmFjaycgLy8gdGhlICdjYWxsYmFjaycga2V5XG4gICAgICAsIGNidmFsID0gb1snanNvbnBDYWxsYmFja05hbWUnXSB8fCByZXF3ZXN0LmdldGNhbGxiYWNrUHJlZml4KHJlcUlkKVxuICAgICAgLCBjYnJlZyA9IG5ldyBSZWdFeHAoJygoXnxcXFxcP3wmKScgKyBjYmtleSArICcpPShbXiZdKyknKVxuICAgICAgLCBtYXRjaCA9IHVybC5tYXRjaChjYnJlZylcbiAgICAgICwgc2NyaXB0ID0gZG9jLmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpXG4gICAgICAsIGxvYWRlZCA9IDBcbiAgICAgICwgaXNJRTEwID0gbmF2aWdhdG9yLnVzZXJBZ2VudC5pbmRleE9mKCdNU0lFIDEwLjAnKSAhPT0gLTFcblxuICAgIGlmIChtYXRjaCkge1xuICAgICAgaWYgKG1hdGNoWzNdID09PSAnPycpIHtcbiAgICAgICAgdXJsID0gdXJsLnJlcGxhY2UoY2JyZWcsICckMT0nICsgY2J2YWwpIC8vIHdpbGRjYXJkIGNhbGxiYWNrIGZ1bmMgbmFtZVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2J2YWwgPSBtYXRjaFszXSAvLyBwcm92aWRlZCBjYWxsYmFjayBmdW5jIG5hbWVcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdXJsID0gdXJsYXBwZW5kKHVybCwgY2JrZXkgKyAnPScgKyBjYnZhbCkgLy8gbm8gY2FsbGJhY2sgZGV0YWlscywgYWRkICdlbVxuICAgIH1cblxuICAgIHdpbltjYnZhbF0gPSBnZW5lcmFsQ2FsbGJhY2tcblxuICAgIHNjcmlwdC50eXBlID0gJ3RleHQvamF2YXNjcmlwdCdcbiAgICBzY3JpcHQuc3JjID0gdXJsXG4gICAgc2NyaXB0LmFzeW5jID0gdHJ1ZVxuICAgIGlmICh0eXBlb2Ygc2NyaXB0Lm9ucmVhZHlzdGF0ZWNoYW5nZSAhPT0gJ3VuZGVmaW5lZCcgJiYgIWlzSUUxMCkge1xuICAgICAgLy8gbmVlZCB0aGlzIGZvciBJRSBkdWUgdG8gb3V0LW9mLW9yZGVyIG9ucmVhZHlzdGF0ZWNoYW5nZSgpLCBiaW5kaW5nIHNjcmlwdFxuICAgICAgLy8gZXhlY3V0aW9uIHRvIGFuIGV2ZW50IGxpc3RlbmVyIGdpdmVzIHVzIGNvbnRyb2wgb3ZlciB3aGVuIHRoZSBzY3JpcHRcbiAgICAgIC8vIGlzIGV4ZWN1dGVkLiBTZWUgaHR0cDovL2phdWJvdXJnLm5ldC8yMDEwLzA3L2xvYWRpbmctc2NyaXB0LWFzLW9uY2xpY2staGFuZGxlci1vZi5odG1sXG4gICAgICBzY3JpcHQuaHRtbEZvciA9IHNjcmlwdC5pZCA9ICdfcmVxd2VzdF8nICsgcmVxSWRcbiAgICB9XG5cbiAgICBzY3JpcHQub25sb2FkID0gc2NyaXB0Lm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmICgoc2NyaXB0W3JlYWR5U3RhdGVdICYmIHNjcmlwdFtyZWFkeVN0YXRlXSAhPT0gJ2NvbXBsZXRlJyAmJiBzY3JpcHRbcmVhZHlTdGF0ZV0gIT09ICdsb2FkZWQnKSB8fCBsb2FkZWQpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgICBzY3JpcHQub25sb2FkID0gc2NyaXB0Lm9ucmVhZHlzdGF0ZWNoYW5nZSA9IG51bGxcbiAgICAgIHNjcmlwdC5vbmNsaWNrICYmIHNjcmlwdC5vbmNsaWNrKClcbiAgICAgIC8vIENhbGwgdGhlIHVzZXIgY2FsbGJhY2sgd2l0aCB0aGUgbGFzdCB2YWx1ZSBzdG9yZWQgYW5kIGNsZWFuIHVwIHZhbHVlcyBhbmQgc2NyaXB0cy5cbiAgICAgIGZuKGxhc3RWYWx1ZSlcbiAgICAgIGxhc3RWYWx1ZSA9IHVuZGVmaW5lZFxuICAgICAgaGVhZC5yZW1vdmVDaGlsZChzY3JpcHQpXG4gICAgICBsb2FkZWQgPSAxXG4gICAgfVxuXG4gICAgLy8gQWRkIHRoZSBzY3JpcHQgdG8gdGhlIERPTSBoZWFkXG4gICAgaGVhZC5hcHBlbmRDaGlsZChzY3JpcHQpXG5cbiAgICAvLyBFbmFibGUgSlNPTlAgdGltZW91dFxuICAgIHJldHVybiB7XG4gICAgICBhYm9ydDogZnVuY3Rpb24gKCkge1xuICAgICAgICBzY3JpcHQub25sb2FkID0gc2NyaXB0Lm9ucmVhZHlzdGF0ZWNoYW5nZSA9IG51bGxcbiAgICAgICAgZXJyKHt9LCAnUmVxdWVzdCBpcyBhYm9ydGVkOiB0aW1lb3V0Jywge30pXG4gICAgICAgIGxhc3RWYWx1ZSA9IHVuZGVmaW5lZFxuICAgICAgICBoZWFkLnJlbW92ZUNoaWxkKHNjcmlwdClcbiAgICAgICAgbG9hZGVkID0gMVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGdldFJlcXVlc3QoZm4sIGVycikge1xuICAgIHZhciBvID0gdGhpcy5vXG4gICAgICAsIG1ldGhvZCA9IChvWydtZXRob2QnXSB8fCAnR0VUJykudG9VcHBlckNhc2UoKVxuICAgICAgLCB1cmwgPSB0eXBlb2YgbyA9PT0gJ3N0cmluZycgPyBvIDogb1sndXJsJ11cbiAgICAgIC8vIGNvbnZlcnQgbm9uLXN0cmluZyBvYmplY3RzIHRvIHF1ZXJ5LXN0cmluZyBmb3JtIHVubGVzcyBvWydwcm9jZXNzRGF0YSddIGlzIGZhbHNlXG4gICAgICAsIGRhdGEgPSAob1sncHJvY2Vzc0RhdGEnXSAhPT0gZmFsc2UgJiYgb1snZGF0YSddICYmIHR5cGVvZiBvWydkYXRhJ10gIT09ICdzdHJpbmcnKVxuICAgICAgICA/IHJlcXdlc3QudG9RdWVyeVN0cmluZyhvWydkYXRhJ10pXG4gICAgICAgIDogKG9bJ2RhdGEnXSB8fCBudWxsKVxuICAgICAgLCBodHRwXG4gICAgICAsIHNlbmRXYWl0ID0gZmFsc2VcblxuICAgIC8vIGlmIHdlJ3JlIHdvcmtpbmcgb24gYSBHRVQgcmVxdWVzdCBhbmQgd2UgaGF2ZSBkYXRhIHRoZW4gd2Ugc2hvdWxkIGFwcGVuZFxuICAgIC8vIHF1ZXJ5IHN0cmluZyB0byBlbmQgb2YgVVJMIGFuZCBub3QgcG9zdCBkYXRhXG4gICAgaWYgKChvWyd0eXBlJ10gPT0gJ2pzb25wJyB8fCBtZXRob2QgPT0gJ0dFVCcpICYmIGRhdGEpIHtcbiAgICAgIHVybCA9IHVybGFwcGVuZCh1cmwsIGRhdGEpXG4gICAgICBkYXRhID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChvWyd0eXBlJ10gPT0gJ2pzb25wJykgcmV0dXJuIGhhbmRsZUpzb25wKG8sIGZuLCBlcnIsIHVybClcblxuICAgIC8vIGdldCB0aGUgeGhyIGZyb20gdGhlIGZhY3RvcnkgaWYgcGFzc2VkXG4gICAgLy8gaWYgdGhlIGZhY3RvcnkgcmV0dXJucyBudWxsLCBmYWxsLWJhY2sgdG8gb3Vyc1xuICAgIGh0dHAgPSAoby54aHIgJiYgby54aHIobykpIHx8IHhocihvKVxuXG4gICAgaHR0cC5vcGVuKG1ldGhvZCwgdXJsLCBvWydhc3luYyddID09PSBmYWxzZSA/IGZhbHNlIDogdHJ1ZSlcbiAgICBzZXRIZWFkZXJzKGh0dHAsIG8pXG4gICAgc2V0Q3JlZGVudGlhbHMoaHR0cCwgbylcbiAgICBpZiAod2luW3hEb21haW5SZXF1ZXN0XSAmJiBodHRwIGluc3RhbmNlb2Ygd2luW3hEb21haW5SZXF1ZXN0XSkge1xuICAgICAgICBodHRwLm9ubG9hZCA9IGZuXG4gICAgICAgIGh0dHAub25lcnJvciA9IGVyclxuICAgICAgICAvLyBOT1RFOiBzZWVcbiAgICAgICAgLy8gaHR0cDovL3NvY2lhbC5tc2RuLm1pY3Jvc29mdC5jb20vRm9ydW1zL2VuLVVTL2lld2ViZGV2ZWxvcG1lbnQvdGhyZWFkLzMwZWYzYWRkLTc2N2MtNDQzNi1iOGE5LWYxY2ExOWI0ODEyZVxuICAgICAgICBodHRwLm9ucHJvZ3Jlc3MgPSBmdW5jdGlvbigpIHt9XG4gICAgICAgIHNlbmRXYWl0ID0gdHJ1ZVxuICAgIH0gZWxzZSB7XG4gICAgICBodHRwLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGhhbmRsZVJlYWR5U3RhdGUodGhpcywgZm4sIGVycilcbiAgICB9XG4gICAgb1snYmVmb3JlJ10gJiYgb1snYmVmb3JlJ10oaHR0cClcbiAgICBpZiAoc2VuZFdhaXQpIHtcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICBodHRwLnNlbmQoZGF0YSlcbiAgICAgIH0sIDIwMClcbiAgICB9IGVsc2Uge1xuICAgICAgaHR0cC5zZW5kKGRhdGEpXG4gICAgfVxuICAgIHJldHVybiBodHRwXG4gIH1cblxuICBmdW5jdGlvbiBSZXF3ZXN0KG8sIGZuKSB7XG4gICAgdGhpcy5vID0gb1xuICAgIHRoaXMuZm4gPSBmblxuXG4gICAgaW5pdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gIH1cblxuICBmdW5jdGlvbiBzZXRUeXBlKGhlYWRlcikge1xuICAgIC8vIGpzb24sIGphdmFzY3JpcHQsIHRleHQvcGxhaW4sIHRleHQvaHRtbCwgeG1sXG4gICAgaWYgKGhlYWRlci5tYXRjaCgnanNvbicpKSByZXR1cm4gJ2pzb24nXG4gICAgaWYgKGhlYWRlci5tYXRjaCgnamF2YXNjcmlwdCcpKSByZXR1cm4gJ2pzJ1xuICAgIGlmIChoZWFkZXIubWF0Y2goJ3RleHQnKSkgcmV0dXJuICdodG1sJ1xuICAgIGlmIChoZWFkZXIubWF0Y2goJ3htbCcpKSByZXR1cm4gJ3htbCdcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXQobywgZm4pIHtcblxuICAgIHRoaXMudXJsID0gdHlwZW9mIG8gPT0gJ3N0cmluZycgPyBvIDogb1sndXJsJ11cbiAgICB0aGlzLnRpbWVvdXQgPSBudWxsXG5cbiAgICAvLyB3aGV0aGVyIHJlcXVlc3QgaGFzIGJlZW4gZnVsZmlsbGVkIGZvciBwdXJwb3NlXG4gICAgLy8gb2YgdHJhY2tpbmcgdGhlIFByb21pc2VzXG4gICAgdGhpcy5fZnVsZmlsbGVkID0gZmFsc2VcbiAgICAvLyBzdWNjZXNzIGhhbmRsZXJzXG4gICAgdGhpcy5fc3VjY2Vzc0hhbmRsZXIgPSBmdW5jdGlvbigpe31cbiAgICB0aGlzLl9mdWxmaWxsbWVudEhhbmRsZXJzID0gW11cbiAgICAvLyBlcnJvciBoYW5kbGVyc1xuICAgIHRoaXMuX2Vycm9ySGFuZGxlcnMgPSBbXVxuICAgIC8vIGNvbXBsZXRlIChib3RoIHN1Y2Nlc3MgYW5kIGZhaWwpIGhhbmRsZXJzXG4gICAgdGhpcy5fY29tcGxldGVIYW5kbGVycyA9IFtdXG4gICAgdGhpcy5fZXJyZWQgPSBmYWxzZVxuICAgIHRoaXMuX3Jlc3BvbnNlQXJncyA9IHt9XG5cbiAgICB2YXIgc2VsZiA9IHRoaXNcblxuICAgIGZuID0gZm4gfHwgZnVuY3Rpb24gKCkge31cblxuICAgIGlmIChvWyd0aW1lb3V0J10pIHtcbiAgICAgIHRoaXMudGltZW91dCA9IHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICB0aW1lZE91dCgpXG4gICAgICB9LCBvWyd0aW1lb3V0J10pXG4gICAgfVxuXG4gICAgaWYgKG9bJ3N1Y2Nlc3MnXSkge1xuICAgICAgdGhpcy5fc3VjY2Vzc0hhbmRsZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIG9bJ3N1Y2Nlc3MnXS5hcHBseShvLCBhcmd1bWVudHMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG9bJ2Vycm9yJ10pIHtcbiAgICAgIHRoaXMuX2Vycm9ySGFuZGxlcnMucHVzaChmdW5jdGlvbiAoKSB7XG4gICAgICAgIG9bJ2Vycm9yJ10uYXBwbHkobywgYXJndW1lbnRzKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAob1snY29tcGxldGUnXSkge1xuICAgICAgdGhpcy5fY29tcGxldGVIYW5kbGVycy5wdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgb1snY29tcGxldGUnXS5hcHBseShvLCBhcmd1bWVudHMpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGNvbXBsZXRlIChyZXNwKSB7XG4gICAgICBvWyd0aW1lb3V0J10gJiYgY2xlYXJUaW1lb3V0KHNlbGYudGltZW91dClcbiAgICAgIHNlbGYudGltZW91dCA9IG51bGxcbiAgICAgIHdoaWxlIChzZWxmLl9jb21wbGV0ZUhhbmRsZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc2VsZi5fY29tcGxldGVIYW5kbGVycy5zaGlmdCgpKHJlc3ApXG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc3VjY2VzcyAocmVzcCkge1xuICAgICAgdmFyIHR5cGUgPSBvWyd0eXBlJ10gfHwgcmVzcCAmJiBzZXRUeXBlKHJlc3AuZ2V0UmVzcG9uc2VIZWFkZXIoJ0NvbnRlbnQtVHlwZScpKSAvLyByZXNwIGNhbiBiZSB1bmRlZmluZWQgaW4gSUVcbiAgICAgIHJlc3AgPSAodHlwZSAhPT0gJ2pzb25wJykgPyBzZWxmLnJlcXVlc3QgOiByZXNwXG4gICAgICAvLyB1c2UgZ2xvYmFsIGRhdGEgZmlsdGVyIG9uIHJlc3BvbnNlIHRleHRcbiAgICAgIHZhciBmaWx0ZXJlZFJlc3BvbnNlID0gZ2xvYmFsU2V0dXBPcHRpb25zLmRhdGFGaWx0ZXIocmVzcC5yZXNwb25zZVRleHQsIHR5cGUpXG4gICAgICAgICwgciA9IGZpbHRlcmVkUmVzcG9uc2VcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlc3AucmVzcG9uc2VUZXh0ID0gclxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBjYW4ndCBhc3NpZ24gdGhpcyBpbiBJRTw9OCwganVzdCBpZ25vcmVcbiAgICAgIH1cbiAgICAgIGlmIChyKSB7XG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICBjYXNlICdqc29uJzpcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmVzcCA9IHdpbi5KU09OID8gd2luLkpTT04ucGFyc2UocikgOiBldmFsKCcoJyArIHIgKyAnKScpXG4gICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICByZXR1cm4gZXJyb3IocmVzcCwgJ0NvdWxkIG5vdCBwYXJzZSBKU09OIGluIHJlc3BvbnNlJywgZXJyKVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlICdqcyc6XG4gICAgICAgICAgcmVzcCA9IGV2YWwocilcbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlICdodG1sJzpcbiAgICAgICAgICByZXNwID0gclxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJ3htbCc6XG4gICAgICAgICAgcmVzcCA9IHJlc3AucmVzcG9uc2VYTUxcbiAgICAgICAgICAgICAgJiYgcmVzcC5yZXNwb25zZVhNTC5wYXJzZUVycm9yIC8vIElFIHRyb2xvbG9cbiAgICAgICAgICAgICAgJiYgcmVzcC5yZXNwb25zZVhNTC5wYXJzZUVycm9yLmVycm9yQ29kZVxuICAgICAgICAgICAgICAmJiByZXNwLnJlc3BvbnNlWE1MLnBhcnNlRXJyb3IucmVhc29uXG4gICAgICAgICAgICA/IG51bGxcbiAgICAgICAgICAgIDogcmVzcC5yZXNwb25zZVhNTFxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgc2VsZi5fcmVzcG9uc2VBcmdzLnJlc3AgPSByZXNwXG4gICAgICBzZWxmLl9mdWxmaWxsZWQgPSB0cnVlXG4gICAgICBmbihyZXNwKVxuICAgICAgc2VsZi5fc3VjY2Vzc0hhbmRsZXIocmVzcClcbiAgICAgIHdoaWxlIChzZWxmLl9mdWxmaWxsbWVudEhhbmRsZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmVzcCA9IHNlbGYuX2Z1bGZpbGxtZW50SGFuZGxlcnMuc2hpZnQoKShyZXNwKVxuICAgICAgfVxuXG4gICAgICBjb21wbGV0ZShyZXNwKVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRpbWVkT3V0KCkge1xuICAgICAgc2VsZi5fdGltZWRPdXQgPSB0cnVlXG4gICAgICBzZWxmLnJlcXVlc3QuYWJvcnQoKSAgICAgIFxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVycm9yKHJlc3AsIG1zZywgdCkge1xuICAgICAgcmVzcCA9IHNlbGYucmVxdWVzdFxuICAgICAgc2VsZi5fcmVzcG9uc2VBcmdzLnJlc3AgPSByZXNwXG4gICAgICBzZWxmLl9yZXNwb25zZUFyZ3MubXNnID0gbXNnXG4gICAgICBzZWxmLl9yZXNwb25zZUFyZ3MudCA9IHRcbiAgICAgIHNlbGYuX2VycmVkID0gdHJ1ZVxuICAgICAgd2hpbGUgKHNlbGYuX2Vycm9ySGFuZGxlcnMubGVuZ3RoID4gMCkge1xuICAgICAgICBzZWxmLl9lcnJvckhhbmRsZXJzLnNoaWZ0KCkocmVzcCwgbXNnLCB0KVxuICAgICAgfVxuICAgICAgY29tcGxldGUocmVzcClcbiAgICB9XG5cbiAgICB0aGlzLnJlcXVlc3QgPSBnZXRSZXF1ZXN0LmNhbGwodGhpcywgc3VjY2VzcywgZXJyb3IpXG4gIH1cblxuICBSZXF3ZXN0LnByb3RvdHlwZSA9IHtcbiAgICBhYm9ydDogZnVuY3Rpb24gKCkge1xuICAgICAgdGhpcy5fYWJvcnRlZCA9IHRydWVcbiAgICAgIHRoaXMucmVxdWVzdC5hYm9ydCgpXG4gICAgfVxuXG4gICwgcmV0cnk6IGZ1bmN0aW9uICgpIHtcbiAgICAgIGluaXQuY2FsbCh0aGlzLCB0aGlzLm8sIHRoaXMuZm4pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogU21hbGwgZGV2aWF0aW9uIGZyb20gdGhlIFByb21pc2VzIEEgQ29tbW9uSnMgc3BlY2lmaWNhdGlvblxuICAgICAqIGh0dHA6Ly93aWtpLmNvbW1vbmpzLm9yZy93aWtpL1Byb21pc2VzL0FcbiAgICAgKi9cblxuICAgIC8qKlxuICAgICAqIGB0aGVuYCB3aWxsIGV4ZWN1dGUgdXBvbiBzdWNjZXNzZnVsIHJlcXVlc3RzXG4gICAgICovXG4gICwgdGhlbjogZnVuY3Rpb24gKHN1Y2Nlc3MsIGZhaWwpIHtcbiAgICAgIHN1Y2Nlc3MgPSBzdWNjZXNzIHx8IGZ1bmN0aW9uICgpIHt9XG4gICAgICBmYWlsID0gZmFpbCB8fCBmdW5jdGlvbiAoKSB7fVxuICAgICAgaWYgKHRoaXMuX2Z1bGZpbGxlZCkge1xuICAgICAgICB0aGlzLl9yZXNwb25zZUFyZ3MucmVzcCA9IHN1Y2Nlc3ModGhpcy5fcmVzcG9uc2VBcmdzLnJlc3ApXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2VycmVkKSB7XG4gICAgICAgIGZhaWwodGhpcy5fcmVzcG9uc2VBcmdzLnJlc3AsIHRoaXMuX3Jlc3BvbnNlQXJncy5tc2csIHRoaXMuX3Jlc3BvbnNlQXJncy50KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5fZnVsZmlsbG1lbnRIYW5kbGVycy5wdXNoKHN1Y2Nlc3MpXG4gICAgICAgIHRoaXMuX2Vycm9ySGFuZGxlcnMucHVzaChmYWlsKVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBgYWx3YXlzYCB3aWxsIGV4ZWN1dGUgd2hldGhlciB0aGUgcmVxdWVzdCBzdWNjZWVkcyBvciBmYWlsc1xuICAgICAqL1xuICAsIGFsd2F5czogZnVuY3Rpb24gKGZuKSB7XG4gICAgICBpZiAodGhpcy5fZnVsZmlsbGVkIHx8IHRoaXMuX2VycmVkKSB7XG4gICAgICAgIGZuKHRoaXMuX3Jlc3BvbnNlQXJncy5yZXNwKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5fY29tcGxldGVIYW5kbGVycy5wdXNoKGZuKVxuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBgZmFpbGAgd2lsbCBleGVjdXRlIHdoZW4gdGhlIHJlcXVlc3QgZmFpbHNcbiAgICAgKi9cbiAgLCBmYWlsOiBmdW5jdGlvbiAoZm4pIHtcbiAgICAgIGlmICh0aGlzLl9lcnJlZCkge1xuICAgICAgICBmbih0aGlzLl9yZXNwb25zZUFyZ3MucmVzcCwgdGhpcy5fcmVzcG9uc2VBcmdzLm1zZywgdGhpcy5fcmVzcG9uc2VBcmdzLnQpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLl9lcnJvckhhbmRsZXJzLnB1c2goZm4pXG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgLCAnY2F0Y2gnOiBmdW5jdGlvbiAoZm4pIHtcbiAgICAgIHJldHVybiB0aGlzLmZhaWwoZm4pXG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcmVxd2VzdChvLCBmbikge1xuICAgIHJldHVybiBuZXcgUmVxd2VzdChvLCBmbilcbiAgfVxuXG4gIC8vIG5vcm1hbGl6ZSBuZXdsaW5lIHZhcmlhbnRzIGFjY29yZGluZyB0byBzcGVjIC0+IENSTEZcbiAgZnVuY3Rpb24gbm9ybWFsaXplKHMpIHtcbiAgICByZXR1cm4gcyA/IHMucmVwbGFjZSgvXFxyP1xcbi9nLCAnXFxyXFxuJykgOiAnJ1xuICB9XG5cbiAgZnVuY3Rpb24gc2VyaWFsKGVsLCBjYikge1xuICAgIHZhciBuID0gZWwubmFtZVxuICAgICAgLCB0ID0gZWwudGFnTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgICAsIG9wdENiID0gZnVuY3Rpb24gKG8pIHtcbiAgICAgICAgICAvLyBJRSBnaXZlcyB2YWx1ZT1cIlwiIGV2ZW4gd2hlcmUgdGhlcmUgaXMgbm8gdmFsdWUgYXR0cmlidXRlXG4gICAgICAgICAgLy8gJ3NwZWNpZmllZCcgcmVmOiBodHRwOi8vd3d3LnczLm9yZy9UUi9ET00tTGV2ZWwtMy1Db3JlL2NvcmUuaHRtbCNJRC04NjI1MjkyNzNcbiAgICAgICAgICBpZiAobyAmJiAhb1snZGlzYWJsZWQnXSlcbiAgICAgICAgICAgIGNiKG4sIG5vcm1hbGl6ZShvWydhdHRyaWJ1dGVzJ11bJ3ZhbHVlJ10gJiYgb1snYXR0cmlidXRlcyddWyd2YWx1ZSddWydzcGVjaWZpZWQnXSA/IG9bJ3ZhbHVlJ10gOiBvWyd0ZXh0J10pKVxuICAgICAgICB9XG4gICAgICAsIGNoLCByYSwgdmFsLCBpXG5cbiAgICAvLyBkb24ndCBzZXJpYWxpemUgZWxlbWVudHMgdGhhdCBhcmUgZGlzYWJsZWQgb3Igd2l0aG91dCBhIG5hbWVcbiAgICBpZiAoZWwuZGlzYWJsZWQgfHwgIW4pIHJldHVyblxuXG4gICAgc3dpdGNoICh0KSB7XG4gICAgY2FzZSAnaW5wdXQnOlxuICAgICAgaWYgKCEvcmVzZXR8YnV0dG9ufGltYWdlfGZpbGUvaS50ZXN0KGVsLnR5cGUpKSB7XG4gICAgICAgIGNoID0gL2NoZWNrYm94L2kudGVzdChlbC50eXBlKVxuICAgICAgICByYSA9IC9yYWRpby9pLnRlc3QoZWwudHlwZSlcbiAgICAgICAgdmFsID0gZWwudmFsdWVcbiAgICAgICAgLy8gV2ViS2l0IGdpdmVzIHVzIFwiXCIgaW5zdGVhZCBvZiBcIm9uXCIgaWYgYSBjaGVja2JveCBoYXMgbm8gdmFsdWUsIHNvIGNvcnJlY3QgaXQgaGVyZVxuICAgICAgICA7KCEoY2ggfHwgcmEpIHx8IGVsLmNoZWNrZWQpICYmIGNiKG4sIG5vcm1hbGl6ZShjaCAmJiB2YWwgPT09ICcnID8gJ29uJyA6IHZhbCkpXG4gICAgICB9XG4gICAgICBicmVha1xuICAgIGNhc2UgJ3RleHRhcmVhJzpcbiAgICAgIGNiKG4sIG5vcm1hbGl6ZShlbC52YWx1ZSkpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3NlbGVjdCc6XG4gICAgICBpZiAoZWwudHlwZS50b0xvd2VyQ2FzZSgpID09PSAnc2VsZWN0LW9uZScpIHtcbiAgICAgICAgb3B0Q2IoZWwuc2VsZWN0ZWRJbmRleCA+PSAwID8gZWwub3B0aW9uc1tlbC5zZWxlY3RlZEluZGV4XSA6IG51bGwpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGkgPSAwOyBlbC5sZW5ndGggJiYgaSA8IGVsLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgZWwub3B0aW9uc1tpXS5zZWxlY3RlZCAmJiBvcHRDYihlbC5vcHRpb25zW2ldKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBicmVha1xuICAgIH1cbiAgfVxuXG4gIC8vIGNvbGxlY3QgdXAgYWxsIGZvcm0gZWxlbWVudHMgZm91bmQgZnJvbSB0aGUgcGFzc2VkIGFyZ3VtZW50IGVsZW1lbnRzIGFsbFxuICAvLyB0aGUgd2F5IGRvd24gdG8gY2hpbGQgZWxlbWVudHM7IHBhc3MgYSAnPGZvcm0+JyBvciBmb3JtIGZpZWxkcy5cbiAgLy8gY2FsbGVkIHdpdGggJ3RoaXMnPWNhbGxiYWNrIHRvIHVzZSBmb3Igc2VyaWFsKCkgb24gZWFjaCBlbGVtZW50XG4gIGZ1bmN0aW9uIGVhY2hGb3JtRWxlbWVudCgpIHtcbiAgICB2YXIgY2IgPSB0aGlzXG4gICAgICAsIGUsIGlcbiAgICAgICwgc2VyaWFsaXplU3VidGFncyA9IGZ1bmN0aW9uIChlLCB0YWdzKSB7XG4gICAgICAgICAgdmFyIGksIGosIGZhXG4gICAgICAgICAgZm9yIChpID0gMDsgaSA8IHRhZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGZhID0gZVtieVRhZ10odGFnc1tpXSlcbiAgICAgICAgICAgIGZvciAoaiA9IDA7IGogPCBmYS5sZW5ndGg7IGorKykgc2VyaWFsKGZhW2pdLCBjYilcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgIGZvciAoaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGUgPSBhcmd1bWVudHNbaV1cbiAgICAgIGlmICgvaW5wdXR8c2VsZWN0fHRleHRhcmVhL2kudGVzdChlLnRhZ05hbWUpKSBzZXJpYWwoZSwgY2IpXG4gICAgICBzZXJpYWxpemVTdWJ0YWdzKGUsIFsgJ2lucHV0JywgJ3NlbGVjdCcsICd0ZXh0YXJlYScgXSlcbiAgICB9XG4gIH1cblxuICAvLyBzdGFuZGFyZCBxdWVyeSBzdHJpbmcgc3R5bGUgc2VyaWFsaXphdGlvblxuICBmdW5jdGlvbiBzZXJpYWxpemVRdWVyeVN0cmluZygpIHtcbiAgICByZXR1cm4gcmVxd2VzdC50b1F1ZXJ5U3RyaW5nKHJlcXdlc3Quc2VyaWFsaXplQXJyYXkuYXBwbHkobnVsbCwgYXJndW1lbnRzKSlcbiAgfVxuXG4gIC8vIHsgJ25hbWUnOiAndmFsdWUnLCAuLi4gfSBzdHlsZSBzZXJpYWxpemF0aW9uXG4gIGZ1bmN0aW9uIHNlcmlhbGl6ZUhhc2goKSB7XG4gICAgdmFyIGhhc2ggPSB7fVxuICAgIGVhY2hGb3JtRWxlbWVudC5hcHBseShmdW5jdGlvbiAobmFtZSwgdmFsdWUpIHtcbiAgICAgIGlmIChuYW1lIGluIGhhc2gpIHtcbiAgICAgICAgaGFzaFtuYW1lXSAmJiAhaXNBcnJheShoYXNoW25hbWVdKSAmJiAoaGFzaFtuYW1lXSA9IFtoYXNoW25hbWVdXSlcbiAgICAgICAgaGFzaFtuYW1lXS5wdXNoKHZhbHVlKVxuICAgICAgfSBlbHNlIGhhc2hbbmFtZV0gPSB2YWx1ZVxuICAgIH0sIGFyZ3VtZW50cylcbiAgICByZXR1cm4gaGFzaFxuICB9XG5cbiAgLy8gWyB7IG5hbWU6ICduYW1lJywgdmFsdWU6ICd2YWx1ZScgfSwgLi4uIF0gc3R5bGUgc2VyaWFsaXphdGlvblxuICByZXF3ZXN0LnNlcmlhbGl6ZUFycmF5ID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBhcnIgPSBbXVxuICAgIGVhY2hGb3JtRWxlbWVudC5hcHBseShmdW5jdGlvbiAobmFtZSwgdmFsdWUpIHtcbiAgICAgIGFyci5wdXNoKHtuYW1lOiBuYW1lLCB2YWx1ZTogdmFsdWV9KVxuICAgIH0sIGFyZ3VtZW50cylcbiAgICByZXR1cm4gYXJyXG4gIH1cblxuICByZXF3ZXN0LnNlcmlhbGl6ZSA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gICAgdmFyIG9wdCwgZm5cbiAgICAgICwgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMClcblxuICAgIG9wdCA9IGFyZ3MucG9wKClcbiAgICBvcHQgJiYgb3B0Lm5vZGVUeXBlICYmIGFyZ3MucHVzaChvcHQpICYmIChvcHQgPSBudWxsKVxuICAgIG9wdCAmJiAob3B0ID0gb3B0LnR5cGUpXG5cbiAgICBpZiAob3B0ID09ICdtYXAnKSBmbiA9IHNlcmlhbGl6ZUhhc2hcbiAgICBlbHNlIGlmIChvcHQgPT0gJ2FycmF5JykgZm4gPSByZXF3ZXN0LnNlcmlhbGl6ZUFycmF5XG4gICAgZWxzZSBmbiA9IHNlcmlhbGl6ZVF1ZXJ5U3RyaW5nXG5cbiAgICByZXR1cm4gZm4uYXBwbHkobnVsbCwgYXJncylcbiAgfVxuXG4gIHJlcXdlc3QudG9RdWVyeVN0cmluZyA9IGZ1bmN0aW9uIChvLCB0cmFkKSB7XG4gICAgdmFyIHByZWZpeCwgaVxuICAgICAgLCB0cmFkaXRpb25hbCA9IHRyYWQgfHwgZmFsc2VcbiAgICAgICwgcyA9IFtdXG4gICAgICAsIGVuYyA9IGVuY29kZVVSSUNvbXBvbmVudFxuICAgICAgLCBhZGQgPSBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgIC8vIElmIHZhbHVlIGlzIGEgZnVuY3Rpb24sIGludm9rZSBpdCBhbmQgcmV0dXJuIGl0cyB2YWx1ZVxuICAgICAgICAgIHZhbHVlID0gKCdmdW5jdGlvbicgPT09IHR5cGVvZiB2YWx1ZSkgPyB2YWx1ZSgpIDogKHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlKVxuICAgICAgICAgIHNbcy5sZW5ndGhdID0gZW5jKGtleSkgKyAnPScgKyBlbmModmFsdWUpXG4gICAgICAgIH1cbiAgICAvLyBJZiBhbiBhcnJheSB3YXMgcGFzc2VkIGluLCBhc3N1bWUgdGhhdCBpdCBpcyBhbiBhcnJheSBvZiBmb3JtIGVsZW1lbnRzLlxuICAgIGlmIChpc0FycmF5KG8pKSB7XG4gICAgICBmb3IgKGkgPSAwOyBvICYmIGkgPCBvLmxlbmd0aDsgaSsrKSBhZGQob1tpXVsnbmFtZSddLCBvW2ldWyd2YWx1ZSddKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiB0cmFkaXRpb25hbCwgZW5jb2RlIHRoZSBcIm9sZFwiIHdheSAodGhlIHdheSAxLjMuMiBvciBvbGRlclxuICAgICAgLy8gZGlkIGl0KSwgb3RoZXJ3aXNlIGVuY29kZSBwYXJhbXMgcmVjdXJzaXZlbHkuXG4gICAgICBmb3IgKHByZWZpeCBpbiBvKSB7XG4gICAgICAgIGlmIChvLmhhc093blByb3BlcnR5KHByZWZpeCkpIGJ1aWxkUGFyYW1zKHByZWZpeCwgb1twcmVmaXhdLCB0cmFkaXRpb25hbCwgYWRkKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNwYWNlcyBzaG91bGQgYmUgKyBhY2NvcmRpbmcgdG8gc3BlY1xuICAgIHJldHVybiBzLmpvaW4oJyYnKS5yZXBsYWNlKC8lMjAvZywgJysnKVxuICB9XG5cbiAgZnVuY3Rpb24gYnVpbGRQYXJhbXMocHJlZml4LCBvYmosIHRyYWRpdGlvbmFsLCBhZGQpIHtcbiAgICB2YXIgbmFtZSwgaSwgdlxuICAgICAgLCByYnJhY2tldCA9IC9cXFtcXF0kL1xuXG4gICAgaWYgKGlzQXJyYXkob2JqKSkge1xuICAgICAgLy8gU2VyaWFsaXplIGFycmF5IGl0ZW0uXG4gICAgICBmb3IgKGkgPSAwOyBvYmogJiYgaSA8IG9iai5sZW5ndGg7IGkrKykge1xuICAgICAgICB2ID0gb2JqW2ldXG4gICAgICAgIGlmICh0cmFkaXRpb25hbCB8fCByYnJhY2tldC50ZXN0KHByZWZpeCkpIHtcbiAgICAgICAgICAvLyBUcmVhdCBlYWNoIGFycmF5IGl0ZW0gYXMgYSBzY2FsYXIuXG4gICAgICAgICAgYWRkKHByZWZpeCwgdilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBidWlsZFBhcmFtcyhwcmVmaXggKyAnWycgKyAodHlwZW9mIHYgPT09ICdvYmplY3QnID8gaSA6ICcnKSArICddJywgdiwgdHJhZGl0aW9uYWwsIGFkZClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAob2JqICYmIG9iai50b1N0cmluZygpID09PSAnW29iamVjdCBPYmplY3RdJykge1xuICAgICAgLy8gU2VyaWFsaXplIG9iamVjdCBpdGVtLlxuICAgICAgZm9yIChuYW1lIGluIG9iaikge1xuICAgICAgICBidWlsZFBhcmFtcyhwcmVmaXggKyAnWycgKyBuYW1lICsgJ10nLCBvYmpbbmFtZV0sIHRyYWRpdGlvbmFsLCBhZGQpXG4gICAgICB9XG5cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU2VyaWFsaXplIHNjYWxhciBpdGVtLlxuICAgICAgYWRkKHByZWZpeCwgb2JqKVxuICAgIH1cbiAgfVxuXG4gIHJlcXdlc3QuZ2V0Y2FsbGJhY2tQcmVmaXggPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGNhbGxiYWNrUHJlZml4XG4gIH1cblxuICAvLyBqUXVlcnkgYW5kIFplcHRvIGNvbXBhdGliaWxpdHksIGRpZmZlcmVuY2VzIGNhbiBiZSByZW1hcHBlZCBoZXJlIHNvIHlvdSBjYW4gY2FsbFxuICAvLyAuYWpheC5jb21wYXQob3B0aW9ucywgY2FsbGJhY2spXG4gIHJlcXdlc3QuY29tcGF0ID0gZnVuY3Rpb24gKG8sIGZuKSB7XG4gICAgaWYgKG8pIHtcbiAgICAgIG9bJ3R5cGUnXSAmJiAob1snbWV0aG9kJ10gPSBvWyd0eXBlJ10pICYmIGRlbGV0ZSBvWyd0eXBlJ11cbiAgICAgIG9bJ2RhdGFUeXBlJ10gJiYgKG9bJ3R5cGUnXSA9IG9bJ2RhdGFUeXBlJ10pXG4gICAgICBvWydqc29ucENhbGxiYWNrJ10gJiYgKG9bJ2pzb25wQ2FsbGJhY2tOYW1lJ10gPSBvWydqc29ucENhbGxiYWNrJ10pICYmIGRlbGV0ZSBvWydqc29ucENhbGxiYWNrJ11cbiAgICAgIG9bJ2pzb25wJ10gJiYgKG9bJ2pzb25wQ2FsbGJhY2snXSA9IG9bJ2pzb25wJ10pXG4gICAgfVxuICAgIHJldHVybiBuZXcgUmVxd2VzdChvLCBmbilcbiAgfVxuXG4gIHJlcXdlc3QuYWpheFNldHVwID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fVxuICAgIGZvciAodmFyIGsgaW4gb3B0aW9ucykge1xuICAgICAgZ2xvYmFsU2V0dXBPcHRpb25zW2tdID0gb3B0aW9uc1trXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXF3ZXN0XG59KTtcbiIsIlxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gdHJpbTtcblxuZnVuY3Rpb24gdHJpbShzdHIpe1xuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMqfFxccyokL2csICcnKTtcbn1cblxuZXhwb3J0cy5sZWZ0ID0gZnVuY3Rpb24oc3RyKXtcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzKi8sICcnKTtcbn07XG5cbmV4cG9ydHMucmlnaHQgPSBmdW5jdGlvbihzdHIpe1xuICByZXR1cm4gc3RyLnJlcGxhY2UoL1xccyokLywgJycpO1xufTtcbiIsInZhciBXaW5DaGFuID0gKGZ1bmN0aW9uKCkge1xuICB2YXIgUkVMQVlfRlJBTUVfTkFNRSA9IFwiX193aW5jaGFuX3JlbGF5X2ZyYW1lXCI7XG4gIHZhciBDTE9TRV9DTUQgPSBcImRpZVwiO1xuXG4gIC8vIGEgcG9ydGFibGUgYWRkTGlzdGVuZXIgaW1wbGVtZW50YXRpb25cbiAgZnVuY3Rpb24gYWRkTGlzdGVuZXIodywgZXZlbnQsIGNiKSB7XG4gICAgaWYody5hdHRhY2hFdmVudCkgdy5hdHRhY2hFdmVudCgnb24nICsgZXZlbnQsIGNiKTtcbiAgICBlbHNlIGlmICh3LmFkZEV2ZW50TGlzdGVuZXIpIHcuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgY2IsIGZhbHNlKTtcbiAgfVxuXG4gIC8vIGEgcG9ydGFibGUgcmVtb3ZlTGlzdGVuZXIgaW1wbGVtZW50YXRpb25cbiAgZnVuY3Rpb24gcmVtb3ZlTGlzdGVuZXIodywgZXZlbnQsIGNiKSB7XG4gICAgaWYody5kZXRhY2hFdmVudCkgdy5kZXRhY2hFdmVudCgnb24nICsgZXZlbnQsIGNiKTtcbiAgICBlbHNlIGlmICh3LnJlbW92ZUV2ZW50TGlzdGVuZXIpIHcucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgY2IsIGZhbHNlKTtcbiAgfVxuXG5cbiAgLy8gY2hlY2tpbmcgZm9yIElFOCBvciBhYm92ZVxuICBmdW5jdGlvbiBpc0ludGVybmV0RXhwbG9yZXIoKSB7XG4gICAgdmFyIHJ2ID0gLTE7IC8vIFJldHVybiB2YWx1ZSBhc3N1bWVzIGZhaWx1cmUuXG4gICAgdmFyIHVhID0gbmF2aWdhdG9yLnVzZXJBZ2VudDtcbiAgICBpZiAobmF2aWdhdG9yLmFwcE5hbWUgPT09ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInKSB7XG4gICAgICB2YXIgcmUgPSBuZXcgUmVnRXhwKFwiTVNJRSAoWzAtOV17MSx9W1xcLjAtOV17MCx9KVwiKTtcbiAgICAgIGlmIChyZS5leGVjKHVhKSAhPSBudWxsKVxuICAgICAgICBydiA9IHBhcnNlRmxvYXQoUmVnRXhwLiQxKTtcbiAgICB9XG4gICAgLy8gSUUgPiAxMVxuICAgIGVsc2UgaWYgKHVhLmluZGV4T2YoXCJUcmlkZW50XCIpID4gLTEpIHtcbiAgICAgIHZhciByZSA9IG5ldyBSZWdFeHAoXCJydjooWzAtOV17MiwyfVtcXC4wLTldezAsfSlcIik7XG4gICAgICBpZiAocmUuZXhlYyh1YSkgIT09IG51bGwpIHtcbiAgICAgICAgcnYgPSBwYXJzZUZsb2F0KFJlZ0V4cC4kMSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ2ID49IDg7XG4gIH1cblxuICAvLyBjaGVja2luZyBNb2JpbGUgRmlyZWZveCAoRmVubmVjKVxuICBmdW5jdGlvbiBpc0Zlbm5lYygpIHtcbiAgICB0cnkge1xuICAgICAgLy8gV2UgbXVzdCBjaGVjayBmb3IgYm90aCBYVUwgYW5kIEphdmEgdmVyc2lvbnMgb2YgRmVubmVjLiAgQm90aCBoYXZlXG4gICAgICAvLyBkaXN0aW5jdCBVQSBzdHJpbmdzLlxuICAgICAgdmFyIHVzZXJBZ2VudCA9IG5hdmlnYXRvci51c2VyQWdlbnQ7XG4gICAgICByZXR1cm4gKHVzZXJBZ2VudC5pbmRleE9mKCdGZW5uZWMvJykgIT0gLTEpIHx8ICAvLyBYVUxcbiAgICAgICAgICAgICAodXNlckFnZW50LmluZGV4T2YoJ0ZpcmVmb3gvJykgIT0gLTEgJiYgdXNlckFnZW50LmluZGV4T2YoJ0FuZHJvaWQnKSAhPSAtMSk7ICAgLy8gSmF2YVxuICAgIH0gY2F0Y2goZSkge31cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBmZWF0dXJlIGNoZWNraW5nIHRvIHNlZSBpZiB0aGlzIHBsYXRmb3JtIGlzIHN1cHBvcnRlZCBhdCBhbGxcbiAgZnVuY3Rpb24gaXNTdXBwb3J0ZWQoKSB7XG4gICAgcmV0dXJuICh3aW5kb3cuSlNPTiAmJiB3aW5kb3cuSlNPTi5zdHJpbmdpZnkgJiZcbiAgICAgICAgICAgIHdpbmRvdy5KU09OLnBhcnNlICYmIHdpbmRvdy5wb3N0TWVzc2FnZSk7XG4gIH1cblxuICAvLyBnaXZlbiBhIFVSTCwgZXh0cmFjdCB0aGUgb3JpZ2luLiBUYWtlbiBmcm9tOiBodHRwczovL2dpdGh1Yi5jb20vZmlyZWJhc2UvZmlyZWJhc2Utc2ltcGxlLWxvZ2luL2Jsb2IvZDJjYjk1YjlmODEyZDg0ODhiZGJmYmE1MWMzYTdjMTUzYmExYTA3NC9qcy9zcmMvc2ltcGxlLWxvZ2luL3RyYW5zcG9ydHMvV2luQ2hhbi5qcyNMMjUtTDMwXG4gIGZ1bmN0aW9uIGV4dHJhY3RPcmlnaW4odXJsKSB7XG4gICAgaWYgKCEvXmh0dHBzPzpcXC9cXC8vLnRlc3QodXJsKSkgdXJsID0gd2luZG93LmxvY2F0aW9uLmhyZWY7XG4gICAgdmFyIG0gPSAvXihodHRwcz86XFwvXFwvW1xcLV9hLXpBLVpcXC4wLTk6XSspLy5leGVjKHVybCk7XG4gICAgaWYgKG0pIHJldHVybiBtWzFdO1xuICAgIHJldHVybiB1cmw7XG4gIH1cblxuICAvLyBmaW5kIHRoZSByZWxheSBpZnJhbWUgaW4gdGhlIG9wZW5lclxuICBmdW5jdGlvbiBmaW5kUmVsYXkoKSB7XG4gICAgdmFyIGxvYyA9IHdpbmRvdy5sb2NhdGlvbjtcbiAgICB2YXIgZnJhbWVzID0gd2luZG93Lm9wZW5lci5mcmFtZXM7XG4gICAgZm9yICh2YXIgaSA9IGZyYW1lcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKGZyYW1lc1tpXS5sb2NhdGlvbi5wcm90b2NvbCA9PT0gd2luZG93LmxvY2F0aW9uLnByb3RvY29sICYmXG4gICAgICAgICAgICBmcmFtZXNbaV0ubG9jYXRpb24uaG9zdCA9PT0gd2luZG93LmxvY2F0aW9uLmhvc3QgJiZcbiAgICAgICAgICAgIGZyYW1lc1tpXS5uYW1lID09PSBSRUxBWV9GUkFNRV9OQU1FKVxuICAgICAgICB7XG4gICAgICAgICAgcmV0dXJuIGZyYW1lc1tpXTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaChlKSB7IH1cbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIGlzSUUgPSBpc0ludGVybmV0RXhwbG9yZXIoKTtcblxuICBpZiAoaXNTdXBwb3J0ZWQoKSkge1xuICAgIC8qICBHZW5lcmFsIGZsb3c6XG4gICAgICogICAgICAgICAgICAgICAgICAwLiB1c2VyIGNsaWNrc1xuICAgICAqICAoSUUgU1BFQ0lGSUMpICAgMS4gY2FsbGVyIGFkZHMgcmVsYXkgaWZyYW1lIChzZXJ2ZWQgZnJvbSB0cnVzdGVkIGRvbWFpbikgdG8gRE9NXG4gICAgICogICAgICAgICAgICAgICAgICAyLiBjYWxsZXIgb3BlbnMgd2luZG93ICh3aXRoIGNvbnRlbnQgZnJvbSB0cnVzdGVkIGRvbWFpbilcbiAgICAgKiAgICAgICAgICAgICAgICAgIDMuIHdpbmRvdyBvbiBvcGVuaW5nIGFkZHMgYSBsaXN0ZW5lciB0byAnbWVzc2FnZSdcbiAgICAgKiAgKElFIFNQRUNJRklDKSAgIDQuIHdpbmRvdyBvbiBvcGVuaW5nIGZpbmRzIGlmcmFtZVxuICAgICAqICAgICAgICAgICAgICAgICAgNS4gd2luZG93IGNoZWNrcyBpZiBpZnJhbWUgaXMgXCJsb2FkZWRcIiAtIGhhcyBhICdkb1Bvc3QnIGZ1bmN0aW9uIHlldFxuICAgICAqICAoSUUgU1BFQ0lGSUM1KSAgNWEuIGlmIGlmcmFtZS5kb1Bvc3QgZXhpc3RzLCB3aW5kb3cgdXNlcyBpdCB0byBzZW5kIHJlYWR5IGV2ZW50IHRvIGNhbGxlclxuICAgICAqICAoSUUgU1BFQ0lGSUM1KSAgNWIuIGlmIGlmcmFtZS5kb1Bvc3QgZG9lc24ndCBleGlzdCwgd2luZG93IHdhaXRzIGZvciBmcmFtZSByZWFkeVxuICAgICAqICAoSUUgU1BFQ0lGSUM1KSAgNWJpLiBvbmNlIHJlYWR5LCB3aW5kb3cgY2FsbHMgaWZyYW1lLmRvUG9zdCB0byBzZW5kIHJlYWR5IGV2ZW50XG4gICAgICogICAgICAgICAgICAgICAgICA2LiBjYWxsZXIgdXBvbiByZWNpZXB0IG9mICdyZWFkeScsIHNlbmRzIGFyZ3NcbiAgICAgKi9cbiAgICByZXR1cm4ge1xuICAgICAgb3BlbjogZnVuY3Rpb24ob3B0cywgY2IpIHtcbiAgICAgICAgaWYgKCFjYikgdGhyb3cgXCJtaXNzaW5nIHJlcXVpcmVkIGNhbGxiYWNrIGFyZ3VtZW50XCI7XG5cbiAgICAgICAgLy8gdGVzdCByZXF1aXJlZCBvcHRpb25zXG4gICAgICAgIHZhciBlcnI7XG4gICAgICAgIGlmICghb3B0cy51cmwpIGVyciA9IFwibWlzc2luZyByZXF1aXJlZCAndXJsJyBwYXJhbWV0ZXJcIjtcbiAgICAgICAgaWYgKCFvcHRzLnJlbGF5X3VybCkgZXJyID0gXCJtaXNzaW5nIHJlcXVpcmVkICdyZWxheV91cmwnIHBhcmFtZXRlclwiO1xuICAgICAgICBpZiAoZXJyKSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBjYihlcnIpOyB9LCAwKTtcblxuICAgICAgICAvLyBzdXBwbHkgZGVmYXVsdCBvcHRpb25zXG4gICAgICAgIGlmICghb3B0cy53aW5kb3dfbmFtZSkgb3B0cy53aW5kb3dfbmFtZSA9IG51bGw7XG4gICAgICAgIGlmICghb3B0cy53aW5kb3dfZmVhdHVyZXMgfHwgaXNGZW5uZWMoKSkgb3B0cy53aW5kb3dfZmVhdHVyZXMgPSB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gb3B0cy5wYXJhbXMgbWF5IGJlIHVuZGVmaW5lZFxuXG4gICAgICAgIHZhciBpZnJhbWU7XG5cbiAgICAgICAgLy8gc2FuaXR5IGNoZWNrLCBhcmUgdXJsIGFuZCByZWxheV91cmwgdGhlIHNhbWUgb3JpZ2luP1xuICAgICAgICB2YXIgb3JpZ2luID0gZXh0cmFjdE9yaWdpbihvcHRzLnVybCk7XG4gICAgICAgIGlmIChvcmlnaW4gIT09IGV4dHJhY3RPcmlnaW4ob3B0cy5yZWxheV91cmwpKSB7XG4gICAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBjYignaW52YWxpZCBhcmd1bWVudHM6IG9yaWdpbiBvZiB1cmwgYW5kIHJlbGF5X3VybCBtdXN0IG1hdGNoJyk7XG4gICAgICAgICAgfSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgbWVzc2FnZVRhcmdldDtcblxuICAgICAgICBpZiAoaXNJRSkge1xuICAgICAgICAgIC8vIGZpcnN0IHdlIG5lZWQgdG8gYWRkIGEgXCJyZWxheVwiIGlmcmFtZSB0byB0aGUgZG9jdW1lbnQgdGhhdCdzIHNlcnZlZFxuICAgICAgICAgIC8vIGZyb20gdGhlIHRhcmdldCBkb21haW4uICBXZSBjYW4gcG9zdG1lc3NhZ2UgaW50byBhIGlmcmFtZSwgYnV0IG5vdCBhXG4gICAgICAgICAgLy8gd2luZG93XG4gICAgICAgICAgaWZyYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlmcmFtZVwiKTtcbiAgICAgICAgICAvLyBpZnJhbWUuc2V0QXR0cmlidXRlKCduYW1lJywgZnJhbWVuYW1lKTtcbiAgICAgICAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCdzcmMnLCBvcHRzLnJlbGF5X3VybCk7XG4gICAgICAgICAgaWZyYW1lLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgICBpZnJhbWUuc2V0QXR0cmlidXRlKCduYW1lJywgUkVMQVlfRlJBTUVfTkFNRSk7XG4gICAgICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChpZnJhbWUpO1xuICAgICAgICAgIG1lc3NhZ2VUYXJnZXQgPSBpZnJhbWUuY29udGVudFdpbmRvdztcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciB3ID0gb3B0cy5wb3B1cCB8fCB3aW5kb3cub3BlbihvcHRzLnVybCwgb3B0cy53aW5kb3dfbmFtZSwgb3B0cy53aW5kb3dfZmVhdHVyZXMpO1xuICAgICAgICBpZiAob3B0cy5wb3B1cCkge1xuICAgICAgICAgIHcubG9jYXRpb24uaHJlZiA9IG9wdHMudXJsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFtZXNzYWdlVGFyZ2V0KSBtZXNzYWdlVGFyZ2V0ID0gdztcblxuICAgICAgICAvLyBsZXRzIGxpc3RlbiBpbiBjYXNlIHRoZSB3aW5kb3cgYmxvd3MgdXAgYmVmb3JlIHRlbGxpbmcgdXNcbiAgICAgICAgdmFyIGNsb3NlSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAodyAmJiB3LmNsb3NlZCkge1xuICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgaWYgKGNiKSB7XG4gICAgICAgICAgICAgIGNiKCdVc2VyIGNsb3NlZCB0aGUgcG9wdXAgd2luZG93Jyk7XG4gICAgICAgICAgICAgIGNiID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sIDUwMCk7XG5cbiAgICAgICAgdmFyIHJlcSA9IEpTT04uc3RyaW5naWZ5KHthOiAncmVxdWVzdCcsIGQ6IG9wdHMucGFyYW1zfSk7XG5cbiAgICAgICAgLy8gY2xlYW51cCBvbiB1bmxvYWRcbiAgICAgICAgZnVuY3Rpb24gY2xlYW51cCgpIHtcbiAgICAgICAgICBpZiAoaWZyYW1lKSBkb2N1bWVudC5ib2R5LnJlbW92ZUNoaWxkKGlmcmFtZSk7XG4gICAgICAgICAgaWZyYW1lID0gdW5kZWZpbmVkO1xuICAgICAgICAgIGlmIChjbG9zZUludGVydmFsKSBjbG9zZUludGVydmFsID0gY2xlYXJJbnRlcnZhbChjbG9zZUludGVydmFsKTtcbiAgICAgICAgICByZW1vdmVMaXN0ZW5lcih3aW5kb3csICdtZXNzYWdlJywgb25NZXNzYWdlKTtcbiAgICAgICAgICByZW1vdmVMaXN0ZW5lcih3aW5kb3csICd1bmxvYWQnLCBjbGVhbnVwKTtcbiAgICAgICAgICBpZiAodykge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgdy5jbG9zZSgpO1xuICAgICAgICAgICAgfSBjYXRjaCAoc2VjdXJpdHlWaW9sYXRpb24pIHtcbiAgICAgICAgICAgICAgLy8gVGhpcyBoYXBwZW5zIGluIE9wZXJhIDEyIHNvbWV0aW1lc1xuICAgICAgICAgICAgICAvLyBzZWUgaHR0cHM6Ly9naXRodWIuY29tL21vemlsbGEvYnJvd3NlcmlkL2lzc3Vlcy8xODQ0XG4gICAgICAgICAgICAgIG1lc3NhZ2VUYXJnZXQucG9zdE1lc3NhZ2UoQ0xPU0VfQ01ELCBvcmlnaW4pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB3ID0gbWVzc2FnZVRhcmdldCA9IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGFkZExpc3RlbmVyKHdpbmRvdywgJ3VubG9hZCcsIGNsZWFudXApO1xuXG4gICAgICAgIGZ1bmN0aW9uIG9uTWVzc2FnZShlKSB7XG4gICAgICAgICAgaWYgKGUub3JpZ2luICE9PSBvcmlnaW4pIHsgcmV0dXJuOyB9XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHZhciBkID0gSlNPTi5wYXJzZShlLmRhdGEpO1xuICAgICAgICAgICAgaWYgKGQuYSA9PT0gJ3JlYWR5JykgbWVzc2FnZVRhcmdldC5wb3N0TWVzc2FnZShyZXEsIG9yaWdpbik7XG4gICAgICAgICAgICBlbHNlIGlmIChkLmEgPT09ICdlcnJvcicpIHtcbiAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICBpZiAoY2IpIHtcbiAgICAgICAgICAgICAgICBjYihkLmQpO1xuICAgICAgICAgICAgICAgIGNiID0gbnVsbDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmIChkLmEgPT09ICdyZXNwb25zZScpIHtcbiAgICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgICBpZiAoY2IpIHtcbiAgICAgICAgICAgICAgICBjYihudWxsLCBkLmQpO1xuICAgICAgICAgICAgICAgIGNiID0gbnVsbDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gY2F0Y2goZXJyKSB7IH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFkZExpc3RlbmVyKHdpbmRvdywgJ21lc3NhZ2UnLCBvbk1lc3NhZ2UpO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgY2xvc2U6IGNsZWFudXAsXG4gICAgICAgICAgZm9jdXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgaWYgKHcpIHtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB3LmZvY3VzKCk7XG4gICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAvLyBJRTcgYmxvd3MgdXAgaGVyZSwgZG8gbm90aGluZ1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgfSxcbiAgICAgIG9uT3BlbjogZnVuY3Rpb24oY2IpIHtcbiAgICAgICAgdmFyIG8gPSBcIipcIjtcbiAgICAgICAgdmFyIG1zZ1RhcmdldCA9IGlzSUUgPyBmaW5kUmVsYXkoKSA6IHdpbmRvdy5vcGVuZXI7XG4gICAgICAgIGlmICghbXNnVGFyZ2V0KSB0aHJvdyBcImNhbid0IGZpbmQgcmVsYXkgZnJhbWVcIjtcbiAgICAgICAgZnVuY3Rpb24gZG9Qb3N0KG1zZykge1xuICAgICAgICAgIG1zZyA9IEpTT04uc3RyaW5naWZ5KG1zZyk7XG4gICAgICAgICAgaWYgKGlzSUUpIG1zZ1RhcmdldC5kb1Bvc3QobXNnLCBvKTtcbiAgICAgICAgICBlbHNlIG1zZ1RhcmdldC5wb3N0TWVzc2FnZShtc2csIG8pO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gb25NZXNzYWdlKGUpIHtcbiAgICAgICAgICAvLyBvbmx5IG9uZSBtZXNzYWdlIGdldHMgdGhyb3VnaCwgYnV0IGxldCdzIG1ha2Ugc3VyZSBpdCdzIGFjdHVhbGx5XG4gICAgICAgICAgLy8gdGhlIG1lc3NhZ2Ugd2UncmUgbG9va2luZyBmb3IgKG90aGVyIGNvZGUgbWF5IGJlIHVzaW5nXG4gICAgICAgICAgLy8gcG9zdG1lc3NhZ2UpIC0gd2UgZG8gdGhpcyBieSBlbnN1cmluZyB0aGUgcGF5bG9hZCBjYW5cbiAgICAgICAgICAvLyBiZSBwYXJzZWQsIGFuZCBpdCdzIGdvdCBhbiAnYScgKGFjdGlvbikgdmFsdWUgb2YgJ3JlcXVlc3QnLlxuICAgICAgICAgIHZhciBkO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBkID0gSlNPTi5wYXJzZShlLmRhdGEpO1xuICAgICAgICAgIH0gY2F0Y2goZXJyKSB7IH1cbiAgICAgICAgICBpZiAoIWQgfHwgZC5hICE9PSAncmVxdWVzdCcpIHJldHVybjtcbiAgICAgICAgICByZW1vdmVMaXN0ZW5lcih3aW5kb3csICdtZXNzYWdlJywgb25NZXNzYWdlKTtcbiAgICAgICAgICBvID0gZS5vcmlnaW47XG4gICAgICAgICAgaWYgKGNiKSB7XG4gICAgICAgICAgICAvLyB0aGlzIHNldFRpbWVvdXQgaXMgY3JpdGljYWxseSBpbXBvcnRhbnQgZm9yIElFOCAtXG4gICAgICAgICAgICAvLyBpbiBpZTggc29tZXRpbWVzIGFkZExpc3RlbmVyIGZvciAnbWVzc2FnZScgY2FuIHN5bmNocm9ub3VzbHlcbiAgICAgICAgICAgIC8vIGNhdXNlIHlvdXIgY2FsbGJhY2sgdG8gYmUgaW52b2tlZC4gIGF3ZXNvbWUuXG4gICAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICBjYihvLCBkLmQsIGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICAgICAgICBjYiA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgICBkb1Bvc3Qoe2E6ICdyZXNwb25zZScsIGQ6IHJ9KTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9LCAwKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmdW5jdGlvbiBvbkRpZShlKSB7XG4gICAgICAgICAgaWYgKGUuZGF0YSA9PT0gQ0xPU0VfQ01EKSB7XG4gICAgICAgICAgICB0cnkgeyB3aW5kb3cuY2xvc2UoKTsgfSBjYXRjaCAob19PKSB7fVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBhZGRMaXN0ZW5lcihpc0lFID8gbXNnVGFyZ2V0IDogd2luZG93LCAnbWVzc2FnZScsIG9uTWVzc2FnZSk7XG4gICAgICAgIGFkZExpc3RlbmVyKGlzSUUgPyBtc2dUYXJnZXQgOiB3aW5kb3csICdtZXNzYWdlJywgb25EaWUpO1xuXG4gICAgICAgIC8vIHdlIGNhbm5vdCBwb3N0IHRvIG91ciBwYXJlbnQgdGhhdCB3ZSdyZSByZWFkeSBiZWZvcmUgdGhlIGlmcmFtZVxuICAgICAgICAvLyBpcyBsb2FkZWQuIChJRSBzcGVjaWZpYyBwb3NzaWJsZSBmYWlsdXJlKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGRvUG9zdCh7YTogXCJyZWFkeVwifSk7XG4gICAgICAgIH0gY2F0Y2goZSkge1xuICAgICAgICAgIC8vIHRoaXMgY29kZSBzaG91bGQgbmV2ZXIgYmUgZXhlY3R1ZWQgb3V0c2lkZSBJRVxuICAgICAgICAgIGFkZExpc3RlbmVyKG1zZ1RhcmdldCwgJ2xvYWQnLCBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgICBkb1Bvc3Qoe2E6IFwicmVhZHlcIn0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gaWYgd2luZG93IGlzIHVubG9hZGVkIGFuZCB0aGUgY2xpZW50IGhhc24ndCBjYWxsZWQgY2IsIGl0J3MgYW4gZXJyb3JcbiAgICAgICAgdmFyIG9uVW5sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIElFOCBkb2Vzbid0IGxpa2UgdGhpcy4uLlxuICAgICAgICAgICAgcmVtb3ZlTGlzdGVuZXIoaXNJRSA/IG1zZ1RhcmdldCA6IHdpbmRvdywgJ21lc3NhZ2UnLCBvbkRpZSk7XG4gICAgICAgICAgfSBjYXRjaCAob2hXZWxsKSB7IH1cbiAgICAgICAgICBpZiAoY2IpIGRvUG9zdCh7IGE6ICdlcnJvcicsIGQ6ICdjbGllbnQgY2xvc2VkIHdpbmRvdycgfSk7XG4gICAgICAgICAgY2IgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgLy8gZXhwbGljaXRseSBjbG9zZSB0aGUgd2luZG93LCBpbiBjYXNlIHRoZSBjbGllbnQgaXMgdHJ5aW5nIHRvIHJlbG9hZCBvciBuYXZcbiAgICAgICAgICB0cnkgeyB3aW5kb3cuY2xvc2UoKTsgfSBjYXRjaCAoZSkgeyB9XG4gICAgICAgIH07XG4gICAgICAgIGFkZExpc3RlbmVyKHdpbmRvdywgJ3VubG9hZCcsIG9uVW5sb2FkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBkZXRhY2g6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmVtb3ZlTGlzdGVuZXIod2luZG93LCAndW5sb2FkJywgb25VbmxvYWQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIHJldHVybiB7XG4gICAgICBvcGVuOiBmdW5jdGlvbih1cmwsIHdpbm9wdHMsIGFyZywgY2IpIHtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHsgY2IoXCJ1bnN1cHBvcnRlZCBicm93c2VyXCIpOyB9LCAwKTtcbiAgICAgIH0sXG4gICAgICBvbk9wZW46IGZ1bmN0aW9uKGNiKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IGNiKFwidW5zdXBwb3J0ZWQgYnJvd3NlclwiKTsgfSwgMCk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxufSkoKTtcblxuaWYgKHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnICYmIG1vZHVsZS5leHBvcnRzKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gV2luQ2hhbjtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gaGFzS2V5c1xuXG5mdW5jdGlvbiBoYXNLZXlzKHNvdXJjZSkge1xuICAgIHJldHVybiBzb3VyY2UgIT09IG51bGwgJiZcbiAgICAgICAgKHR5cGVvZiBzb3VyY2UgPT09IFwib2JqZWN0XCIgfHxcbiAgICAgICAgdHlwZW9mIHNvdXJjZSA9PT0gXCJmdW5jdGlvblwiKVxufVxuIiwidmFyIEtleXMgPSByZXF1aXJlKFwib2JqZWN0LWtleXNcIilcbnZhciBoYXNLZXlzID0gcmVxdWlyZShcIi4vaGFzLWtleXNcIilcblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmRcblxuZnVuY3Rpb24gZXh0ZW5kKCkge1xuICAgIHZhciB0YXJnZXQgPSB7fVxuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIHNvdXJjZSA9IGFyZ3VtZW50c1tpXVxuXG4gICAgICAgIGlmICghaGFzS2V5cyhzb3VyY2UpKSB7XG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGtleXMgPSBLZXlzKHNvdXJjZSlcblxuICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGtleXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgIHZhciBuYW1lID0ga2V5c1tqXVxuICAgICAgICAgICAgdGFyZ2V0W25hbWVdID0gc291cmNlW25hbWVdXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGFyZ2V0XG59XG4iLCJ2YXIgaGFzT3duID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbnZhciBpc0Z1bmN0aW9uID0gZnVuY3Rpb24gKGZuKSB7XG5cdHZhciBpc0Z1bmMgPSAodHlwZW9mIGZuID09PSAnZnVuY3Rpb24nICYmICEoZm4gaW5zdGFuY2VvZiBSZWdFeHApKSB8fCB0b1N0cmluZy5jYWxsKGZuKSA9PT0gJ1tvYmplY3QgRnVuY3Rpb25dJztcblx0aWYgKCFpc0Z1bmMgJiYgdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcpIHtcblx0XHRpc0Z1bmMgPSBmbiA9PT0gd2luZG93LnNldFRpbWVvdXQgfHwgZm4gPT09IHdpbmRvdy5hbGVydCB8fCBmbiA9PT0gd2luZG93LmNvbmZpcm0gfHwgZm4gPT09IHdpbmRvdy5wcm9tcHQ7XG5cdH1cblx0cmV0dXJuIGlzRnVuYztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZm9yRWFjaChvYmosIGZuKSB7XG5cdGlmICghaXNGdW5jdGlvbihmbikpIHtcblx0XHR0aHJvdyBuZXcgVHlwZUVycm9yKCdpdGVyYXRvciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblx0fVxuXHR2YXIgaSwgayxcblx0XHRpc1N0cmluZyA9IHR5cGVvZiBvYmogPT09ICdzdHJpbmcnLFxuXHRcdGwgPSBvYmoubGVuZ3RoLFxuXHRcdGNvbnRleHQgPSBhcmd1bWVudHMubGVuZ3RoID4gMiA/IGFyZ3VtZW50c1syXSA6IG51bGw7XG5cdGlmIChsID09PSArbCkge1xuXHRcdGZvciAoaSA9IDA7IGkgPCBsOyBpKyspIHtcblx0XHRcdGlmIChjb250ZXh0ID09PSBudWxsKSB7XG5cdFx0XHRcdGZuKGlzU3RyaW5nID8gb2JqLmNoYXJBdChpKSA6IG9ialtpXSwgaSwgb2JqKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGZuLmNhbGwoY29udGV4dCwgaXNTdHJpbmcgPyBvYmouY2hhckF0KGkpIDogb2JqW2ldLCBpLCBvYmopO1xuXHRcdFx0fVxuXHRcdH1cblx0fSBlbHNlIHtcblx0XHRmb3IgKGsgaW4gb2JqKSB7XG5cdFx0XHRpZiAoaGFzT3duLmNhbGwob2JqLCBrKSkge1xuXHRcdFx0XHRpZiAoY29udGV4dCA9PT0gbnVsbCkge1xuXHRcdFx0XHRcdGZuKG9ialtrXSwgaywgb2JqKTtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRmbi5jYWxsKGNvbnRleHQsIG9ialtrXSwgaywgb2JqKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0fVxufTtcblxuIiwibW9kdWxlLmV4cG9ydHMgPSBPYmplY3Qua2V5cyB8fCByZXF1aXJlKCcuL3NoaW0nKTtcblxuIiwidmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc0FyZ3VtZW50cyh2YWx1ZSkge1xuXHR2YXIgc3RyID0gdG9TdHJpbmcuY2FsbCh2YWx1ZSk7XG5cdHZhciBpc0FyZ3VtZW50cyA9IHN0ciA9PT0gJ1tvYmplY3QgQXJndW1lbnRzXSc7XG5cdGlmICghaXNBcmd1bWVudHMpIHtcblx0XHRpc0FyZ3VtZW50cyA9IHN0ciAhPT0gJ1tvYmplY3QgQXJyYXldJ1xuXHRcdFx0JiYgdmFsdWUgIT09IG51bGxcblx0XHRcdCYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCdcblx0XHRcdCYmIHR5cGVvZiB2YWx1ZS5sZW5ndGggPT09ICdudW1iZXInXG5cdFx0XHQmJiB2YWx1ZS5sZW5ndGggPj0gMFxuXHRcdFx0JiYgdG9TdHJpbmcuY2FsbCh2YWx1ZS5jYWxsZWUpID09PSAnW29iamVjdCBGdW5jdGlvbl0nO1xuXHR9XG5cdHJldHVybiBpc0FyZ3VtZW50cztcbn07XG5cbiIsIihmdW5jdGlvbiAoKSB7XG5cdFwidXNlIHN0cmljdFwiO1xuXG5cdC8vIG1vZGlmaWVkIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL2tyaXNrb3dhbC9lczUtc2hpbVxuXHR2YXIgaGFzID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eSxcblx0XHR0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcsXG5cdFx0Zm9yRWFjaCA9IHJlcXVpcmUoJy4vZm9yZWFjaCcpLFxuXHRcdGlzQXJncyA9IHJlcXVpcmUoJy4vaXNBcmd1bWVudHMnKSxcblx0XHRoYXNEb250RW51bUJ1ZyA9ICEoeyd0b1N0cmluZyc6IG51bGx9KS5wcm9wZXJ0eUlzRW51bWVyYWJsZSgndG9TdHJpbmcnKSxcblx0XHRoYXNQcm90b0VudW1CdWcgPSAoZnVuY3Rpb24gKCkge30pLnByb3BlcnR5SXNFbnVtZXJhYmxlKCdwcm90b3R5cGUnKSxcblx0XHRkb250RW51bXMgPSBbXG5cdFx0XHRcInRvU3RyaW5nXCIsXG5cdFx0XHRcInRvTG9jYWxlU3RyaW5nXCIsXG5cdFx0XHRcInZhbHVlT2ZcIixcblx0XHRcdFwiaGFzT3duUHJvcGVydHlcIixcblx0XHRcdFwiaXNQcm90b3R5cGVPZlwiLFxuXHRcdFx0XCJwcm9wZXJ0eUlzRW51bWVyYWJsZVwiLFxuXHRcdFx0XCJjb25zdHJ1Y3RvclwiXG5cdFx0XSxcblx0XHRrZXlzU2hpbTtcblxuXHRrZXlzU2hpbSA9IGZ1bmN0aW9uIGtleXMob2JqZWN0KSB7XG5cdFx0dmFyIGlzT2JqZWN0ID0gb2JqZWN0ICE9PSBudWxsICYmIHR5cGVvZiBvYmplY3QgPT09ICdvYmplY3QnLFxuXHRcdFx0aXNGdW5jdGlvbiA9IHRvU3RyaW5nLmNhbGwob2JqZWN0KSA9PT0gJ1tvYmplY3QgRnVuY3Rpb25dJyxcblx0XHRcdGlzQXJndW1lbnRzID0gaXNBcmdzKG9iamVjdCksXG5cdFx0XHR0aGVLZXlzID0gW107XG5cblx0XHRpZiAoIWlzT2JqZWN0ICYmICFpc0Z1bmN0aW9uICYmICFpc0FyZ3VtZW50cykge1xuXHRcdFx0dGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdC5rZXlzIGNhbGxlZCBvbiBhIG5vbi1vYmplY3RcIik7XG5cdFx0fVxuXG5cdFx0aWYgKGlzQXJndW1lbnRzKSB7XG5cdFx0XHRmb3JFYWNoKG9iamVjdCwgZnVuY3Rpb24gKHZhbHVlKSB7XG5cdFx0XHRcdHRoZUtleXMucHVzaCh2YWx1ZSk7XG5cdFx0XHR9KTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0dmFyIG5hbWUsXG5cdFx0XHRcdHNraXBQcm90byA9IGhhc1Byb3RvRW51bUJ1ZyAmJiBpc0Z1bmN0aW9uO1xuXG5cdFx0XHRmb3IgKG5hbWUgaW4gb2JqZWN0KSB7XG5cdFx0XHRcdGlmICghKHNraXBQcm90byAmJiBuYW1lID09PSAncHJvdG90eXBlJykgJiYgaGFzLmNhbGwob2JqZWN0LCBuYW1lKSkge1xuXHRcdFx0XHRcdHRoZUtleXMucHVzaChuYW1lKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGlmIChoYXNEb250RW51bUJ1Zykge1xuXHRcdFx0dmFyIGN0b3IgPSBvYmplY3QuY29uc3RydWN0b3IsXG5cdFx0XHRcdHNraXBDb25zdHJ1Y3RvciA9IGN0b3IgJiYgY3Rvci5wcm90b3R5cGUgPT09IG9iamVjdDtcblxuXHRcdFx0Zm9yRWFjaChkb250RW51bXMsIGZ1bmN0aW9uIChkb250RW51bSkge1xuXHRcdFx0XHRpZiAoIShza2lwQ29uc3RydWN0b3IgJiYgZG9udEVudW0gPT09ICdjb25zdHJ1Y3RvcicpICYmIGhhcy5jYWxsKG9iamVjdCwgZG9udEVudW0pKSB7XG5cdFx0XHRcdFx0dGhlS2V5cy5wdXNoKGRvbnRFbnVtKTtcblx0XHRcdFx0fVxuXHRcdFx0fSk7XG5cdFx0fVxuXHRcdHJldHVybiB0aGVLZXlzO1xuXHR9O1xuXG5cdG1vZHVsZS5leHBvcnRzID0ga2V5c1NoaW07XG59KCkpO1xuXG4iLCJ2YXIgZ2xvYmFsPXR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fTsvKlxuICpcbiAqIFRoaXMgaXMgdXNlZCB0byBidWlsZCB0aGUgYnVuZGxlIHdpdGggYnJvd3NlcmlmeS5cbiAqXG4gKiBUaGUgYnVuZGxlIGlzIHVzZWQgYnkgcGVvcGxlIHdobyBkb2Vzbid0IHVzZSBicm93c2VyaWZ5LlxuICogVGhvc2Ugd2hvIHVzZSBicm93c2VyaWZ5IHdpbGwgaW5zdGFsbCB3aXRoIG5wbSBhbmQgcmVxdWlyZSB0aGUgbW9kdWxlLFxuICogdGhlIHBhY2thZ2UuanNvbiBmaWxlIHBvaW50cyB0byBpbmRleC5qcy5cbiAqL1xudmFyIEF1dGgwID0gcmVxdWlyZSgnLi9pbmRleCcpO1xuXG4vL3VzZSBhbWQgb3IganVzdCB0aHJvdWdodCB0byB3aW5kb3cgb2JqZWN0LlxuaWYgKHR5cGVvZiBnbG9iYWwud2luZG93LmRlZmluZSA9PSAnZnVuY3Rpb24nICYmIGdsb2JhbC53aW5kb3cuZGVmaW5lLmFtZCkge1xuICBnbG9iYWwud2luZG93LmRlZmluZSgnYXV0aDAnLCBmdW5jdGlvbiAoKSB7IHJldHVybiBBdXRoMDsgfSk7XG59IGVsc2UgaWYgKGdsb2JhbC53aW5kb3cpIHtcbiAgZ2xvYmFsLndpbmRvdy5BdXRoMCA9IEF1dGgwO1xufVxuIiwibW9kdWxlLmV4cG9ydHM9e1widmVyc2lvblwiOlwiNi43LjNcIn0iXX0=
;