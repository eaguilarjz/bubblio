angular.module('starter', ['ionic','ionic.service.core', 'ionic-material', 'starter.controllers', 'ngOpenFB', 'ngResource', 'angularReverseGeocode', 'ionic-timepicker'])

// .constant('RESTFUL_URL', 'http://localhost:3000/api')
.constant('RESTFUL_URL', 'http://54.68.138.70:3000/api')

.run(function($ionicPlatform) {
	
   //Parse Initialization
   Parse.initialize("yMlvcsS2rf3ktzvqMcCJcBP8JHS2I5D5YJYV3KUz", "htSsI0RdkOzBaLOKEjjnQVavjgCXzYN5Jm0opecR");

  $ionicPlatform.ready(function() {
	  
    
    if(window.cordova && window.cordova.plugins.Keyboard) {
      cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
    }
    if(window.StatusBar) {
      StatusBar.styleDefault();
    }
 

	//Parse-Facebook Initialization
    if(!(ionic.Platform.isIOS() || ionic.Platform.isAndroid())){
		window.fbAsyncInit = function() {
	       Parse.FacebookUtils.init({
	          appId      : '184619491871652', 
	          version    : 'v2.3',
	          xfbml      : true
	       });
  	   }
 
  		(function(d, s, id){
  			var js, fjs = d.getElementsByTagName(s)[0];
  			 if (d.getElementById(id)) {return;}
  		     js = d.createElement(s); js.id = id;
  		     js.src = "//connect.facebook.net/en_US/sdk.js";
  		     fjs.parentNode.insertBefore(js, fjs);
  		}(document, 'script', 'facebook-jssdk'));
	  }
  });
})

.config(function($stateProvider, $urlRouterProvider, $ionicConfigProvider) {
    
    $stateProvider.state('app', {
        url: '/app',
        abstract: true,
        cache: false,
        templateUrl: 'templates/menu.html',
        controller: 'MenuCtrl'
    })
    
    .state('app.login', {
      url: '/login',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/login.html',
		      controller: 'LoginCtrl'
	      }
      }
    })
    
    .state('app.forgot_password', {
      url: '/forgot_password',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/forgot_password.html',
		      controller: 'LoginCtrl'
	      }
      }
    })

    .state('app.signup', {
      url: '/signup',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/signup.html',
		      controller: 'LoginCtrl'
	      }
      }
    })
    
    .state('app.address', {
        url: '/addresses/:userId/:addressId/:latitude/:longitude',
        cache: false,
        views: {
          'menuContent': {
              templateUrl: 'templates/address.html',
              controller: 'AddressCtrl'
          }
        }
    })
    
	.state('app.dashboard', {
      url: '/dashboard',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/dashboard.html',
		      controller: 'DashboardCtrl'
	      }
	    }
	})
    
	.state('app.orders', {
      url: '/orders',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/orders.html',
		      controller: 'OrdersCtrl'
	      }
	    }
	})
    
	.state('app.review', {
      url: '/review/:orderId',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/review.html',
		      controller: 'ReviewCtrl'
	      }
	    }
	})
    
	.state('app.help', {
      url: '/help',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/help.html',
	      }
	    }
	})
    
	.state('app.order', {
      url: '/orders/:userId/:orderId',
      cache: false,
      views: {
	      'menuContent': {
		      templateUrl: 'templates/order.html',
		      controller: 'OrderCtrl'
	      }
	    }
	})
    
    .state('app.profile', {
      url: '/profile/:latitude/:longitude',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/profile.html',
		      controller: 'ProfileCtrl'
	      }}
    })
    
    .state('app.history', {
      url: '/history/:orderId',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/history.html',
		      controller: 'HistoryCtrl'
	      }}
    })

  .state('app.search', {
    url: '/search/:serviceId',
    views: {
      'menuContent': {
        templateUrl: 'templates/search.html',
        controller: 'SearchCtrl'
      }
    }
  })

  .state('app.confirmation', {
      url: '/confirmation',
      views: {
        'menuContent': {
          templateUrl: 'templates/confirmation.html',
          controller: 'ConfirmationCtrl'
        }
      }
    })
    .state('app.laundromats', {
      url: '/laundromats/:serviceId/:latitude/:longitude/:pickupDate/:deliveryDate/:addressId',
      views: {
        'menuContent': {
          templateUrl: 'templates/laundromats.html',
          controller: 'LaundromatsCtrl'
        }
      }
    })

  .state('app.site', {
    url: '/laundromats/:siteId/:serviceId/:pickupDate/:deliveryDate/:addressId',
    views: {
      'menuContent': {
        templateUrl: 'templates/laundromat.html',
        controller: 'LaundromatCtrl'
      }
    }
  })
<<<<<<< Updated upstream
=======

  .state('app.orders', {
      url: '/orders',
      views: {
        'menuContent': {
          templateUrl: 'templates/orders.html',
          controller: 'OrdersCtrl'
        }}
    });
>>>>>>> Stashed changes
  
  .state('app.paypal', {
      url: '/paypal',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/paypal.html',
		      controller: 'PaypalCtrl'
	      }
      }
    })
    
    .state('app.paypal_success', {
      url: '/paypal',
      views: {
	      'menuContent': {
		      templateUrl: 'templates/paypal_success.html',
		      controller: 'PaypalCtrl'
	      }
      }
    });

    
    // if none of the above states are matched, use this as the fallback
    $urlRouterProvider.otherwise('/app/login');
});