var graph    = require("../index")
  , FBConfig = require("./config").facebook
  , vows     = require("vows")
  , events   = require("events")
  , assert   = require("assert");


var testUser1      = {}
  , appAccessToken = FBConfig.appId + "|" + FBConfig.appSecret
  , testUserParams = {
      installed:     true
    , name:          ""
    , permissions:   'email, public_profile'
    , method:        "post"
    , access_token:  appAccessToken
  };


vows.describe("graph.test").addBatch({
  "Before starting a test suite": {
    topic:  function () {
      return graph.setAccessToken(null);
    },

    "*Access Token* should be null": function (graph) {
      assert.isNull(graph.getAccessToken());
    },

    "should be able to set *request* options": function (graph) {
      var options = {
          timeout:  30000
        , pool:     false
        , headers:  { connection:  "keep-alive" }
      };

      graph.setOptions(options);
      assert.equal(graph.getOptions(), options);

      // reset
      graph.setOptions({});
    }
  }
}).addBatch({
  "When accessing the graphApi": {
    "with no *Access Token** ": {
    },

    "with an *Access Token* ": {
      topic: function () {
        var promise = new events.EventEmitter();

        // create test user
        var testUserUrl = FBConfig.appId + "/accounts/test-users";

        graph.post(testUserUrl, testUserParams, function(err, res) {

          if (!res || res.error
            && ~res.error.message.indexOf("Service temporarily unavailable")) {

            promise.emit("error", err);
            console.error("Can't retreive access token from facebook\n" +
            "Try again in a few minutes");
          } else {

            graph.setAccessToken(res.access_token);
            testUser1 = res;
            promise.emit("success", res);
          }
        });

        return promise;
      },

      // following tests will only happen after 
      // an access token has been set
      "result *keys* should be valid": function(err, res) {
        assert.isNull(err);
        assert.include(res, "id");
        assert.include(res, "access_token");
        assert.include(res, "login_url");
        assert.include(res, "email");
        assert.include(res, "password");
      },

      "and getting data from a protected page": {
        topic: function () {
          graph.get("/817129783203", this.callback);
        },

        "response should be valid": function(err, res) {
          assert.isNull(err);
          assert.equal("817129783203", res.id, "response id should be valid");
        }
      },

      "and getting a user permissions": {
        topic: function () {
          graph.get("/me/permissions", this.callback);
        },

        "test user should have proper permissions": function (err, res) {
          assert.isNull(err);

          var permissions = testUserParams.permissions
            .replace(/ /g,"")
            .split(",");

          permissions.forEach(function(key) {
            assert.deepStrictEqual(res.data.find(p => p.permission===key), {permission:key, status:'granted'});
          });
        }
      },
    }
  }
}).addBatch({
  "When tests are over": {
    topic: function () {
      graph.del(testUser1.id, this.callback);
    },

    "test users should be removed": function(res){
      assert.strictEqual(res.success, true);
    }
  }
}).export(module);
