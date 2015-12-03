/* global angular, document, window */
angular.module('starter.controllers', [])

.service('DialogBox', function($ionicPopup) {

	this.showDialog = function(type, title, message) {
		
		if (type == 'alert') {
			var alertPopup = $ionicPopup.alert({
				title: title,
				template: message
			});
				alertPopup.then(function(res) {
				alertPopup.close();
			});
		}
	}
})

.service('CurrentUser', function() {
	this.firstName = "";
	
	this.getCurrentUser = function(fieldName) {
		return Parse.User.current().get(fieldName);
	}

	var push = new Ionic.Push({ "debug": true });
	push.register(function(token) {
			
		if (token.token != user.get('deviceToken')) {
			var currentUser = Parse.User.current();
			currentUser.set("deviceToken", token.token);
			return currentUser.save();
		} else {
			console.log("did not save deviceToken, same");
		}
	})

	this.getCurrentFirstName = function() {
		return this.getCurrentUser('firstname');
	}
	
	this.getCurrentLastName = function() {
		return Parse.User.current().get('lastname');
	}
	
	this.getCurrentEmail = function() {
		return Parse.User.current().getEmail();
	}
	
	this.getUserId = function() {
		return Parse.User.current().get('userId');
	}

})

.controller('AppCtrl', function($scope, $ionicModal, $ionicPopover, $timeout, $location, $state, $ionicHistory, $ionicPopup) {
			
	$scope.isExpanded = false;
    $scope.hasHeaderFabLeft = false;
    $scope.hasHeaderFabRight = false;
    
	//Layout Functions
	$scope.hideNavBar = function() {
        document.getElementsByTagName('ion-nav-bar')[0].style.display = 'none';
    };
    
	$scope.showNavBar = function() {
        document.getElementsByTagName('ion-nav-bar')[0].style.display = 'block';
    };

	$scope.hasHeader = function() {
        var content = document.getElementsByTagName('ion-content');
        for (var i = 0; i < content.length; i++) {
            if (!content[i].classList.contains('has-header')) {
                content[i].classList.toggle('has-header');
            }
        }

    };
	
	$scope.showHeader = function() {
        $scope.showNavBar();
        $scope.hasHeader();
    };
	
})

//Login Controller
.controller('LoginCtrl', function($scope, $stateParams, $location, $state, $ionicHistory, $ionicLoading, $ionicPopup, ionicMaterialInk, $rootScope, $cordovaFacebook, $http, CurrentUser, Users, DialogBox) {

	$scope.data = {};
	
	//show hamburger icon only if in app.signup mode
	if ($ionicHistory.currentView().stateName == "app.signup") {
		$rootScope.showMenuIcon = true; //show hamburger icon	
	} else {
		$rootScope.showMenuIcon = false; //hide hamburger icon
	}
	
	$scope.signup = function(isValid) {
        // Validate fields
        if (!isValid) {
            return;
        }

        //Create a new user on MySQL
        Users.save({
            email_address: $scope.data.email,
            password: $scope.data.password,
            first_name: $scope.data.firstname,
            last_name: $scope.data.lastname
        }, function(data) {
            //Create a new user on Parse
            var user = new Parse.User();
            user.set("username", $scope.data.email);
            user.set("password", $scope.data.password);
            user.set("email", $scope.data.email);
            user.set("firstname", $scope.data.firstname);
            user.set("lastname", $scope.data.lastname);
            user.set("userId", data.UserId);
            user.signUp(null, {
                success: function(user) {
                    //prevent back button
                    $ionicHistory.nextViewOptions({
                        disableAnimate: true,
                        disableBack: true
                    });
                    
					DialogBox.showDialog("alert", "Welcome to Bubbl.io", "Please login with your username and password.")
                    //go to login window
                    $state.go("app.login", {cache: false});
                },
                error: function(user, error) {
              
                    //show error
                    var alertPopup = $ionicPopup.alert({
                        title: 'Error',
                        template: error.message
                    });
                    alertPopup.then(function(res) {
                        console.log(error.code + " " + error.message);
                    });
                }
            });
        });
	};
	$scope.login = function() {
		$scope.loading = $ionicLoading.show({
			content: 'Logging in',
			animation: 'fade-in',
			showBackdrop: true,
			maxWidth: 200,
			showDelay: 5000
		});
		Parse.User.logIn($scope.data.username, $scope.data.password, {
			success: function(user) {
				$ionicLoading.hide();
				//login successful
				$ionicHistory.nextViewOptions({
					disableAnimate: true,
					disableBack: true
				});
				
				$rootScope.showMenuIcon = true; //show hamburger icon
				$rootScope.firstName = CurrentUser.getCurrentFirstName();
				$rootScope.lastName = CurrentUser.getCurrentLastName();
				$rootScope.email = CurrentUser.getCurrentEmail();	
				$state.go("app.dashboard", {cache: false}); 
				
			},
			error: function(user, error) {
				$ionicLoading.hide();
				//show error
				var alertPopup = $ionicPopup.alert({
					title: 'Error',
					template: error.message
				});
				alertPopup.then(function(res) {
					console.log(error.code + " " + error.message);
				});
			}
		});
	};
	
	$scope.loginFB = function() {
		
		$cordovaFacebook.login(["public_profile", "email"]).then(function(success){
	 
		    console.log(success);
		 
		    //Need to convert expiresIn format from FB to date
		    var expiration_date = new Date();
		    expiration_date.setSeconds(expiration_date.getSeconds() + success.authResponse.expiresIn);
		    expiration_date = expiration_date.toISOString();
		 
		    var facebookAuthData = {
		      "id": success.authResponse.userID,
		      "access_token": success.authResponse.accessToken,
		      "expiration_date": expiration_date
		    };
		    
		   
			Parse.FacebookUtils.logIn(facebookAuthData, {
					success: function(user) {
						if (!user.existed()) {
								FB.api('/me', {fields: ['last_name', 'first_name', 'email']}, function(response) {
		                            Users.save({
		                                email_address: response.email,
		                                password: '',
		                                first_name: response.first_name,
		                                last_name: response.last_name
		                            }, function(data) {
		                                var currentUser = Parse.User.current();
		                                currentUser.set("firstname", response.first_name);
		                                currentUser.set("lastname", response.last_name);
		                                currentUser.set("email", response.email);
		                                currentUser.set("userId", data.UserId);
		                                currentUser.save();
		                                console.log(response);
		                            });
								});
						}
							$ionicLoading.hide();
							$ionicHistory.nextViewOptions({
								disableAnimate: true,
								disableBack: true
							});
							
							$rootScope.showMenuIcon = true; //show hamburger icon
							$rootScope.firstName = CurrentUser.getCurrentFirstName();
							$rootScope.lastName = CurrentUser.getCurrentLastName();
							$rootScope.email = CurrentUser.getCurrentEmail();	
							$state.go("app.dashboard", {cache: false});
						},
					error: function(user, error) {
						DialogBox.showDialog('alert', 'Facebook Error', 'The user cancelled the Facebook login or did not fully authorize.');
					}
				});
	    });
	}
	
	$scope.forgot_password = function() {
		
	$rootScope.showMenuIcon = true; //show hamburger icon

		if ($scope.data.email) {
			Parse.User.requestPasswordReset($scope.data.email, {
				success: function() {
					
					//show dialog box
					DialogBox.showDialog('alert', 'Successful', "Password change successful. Please check your e-mail."); 
					
					//go to login window
                    $state.go("app.login", {cache: false});
				},
					error: function(error) {
					
					//show dialog box
					DialogBox.showDialog('alert', 'Error', error.message); 	
				}
			});
							
		} else {
			//show dialog box
			DialogBox.showDialog('alert', 'Error', "Please try again."); 	
		}
	}

	ionicMaterialInk.displayEffect();
})

//Menu Controller
.controller('MenuCtrl', function($scope, $ionicModal, $ionicLoading, $ionicHistory, $ionicPopover, $timeout, $location, 
                                  $state, $ionicHistory, $ionicPopup, $rootScope, CurrentUser, Geolocation) {
		
	// Obtain latitude and longitude
    $scope.currentLocation = Geolocation.get();
    
	//check if there is a logged-in user
	if (Parse.User.current() != null) {
		$rootScope.showMenuIcon = true; //show hamburger icon
		$scope.toggleDrag = true;
		$rootScope.firstName = CurrentUser.getCurrentFirstName();
		$rootScope.lastName = CurrentUser.getCurrentLastName();
		$rootScope.email = CurrentUser.getCurrentEmail();		
	} else {
		Parse.User.logOut();
		$scope.toggleDrag = false;
		console.log("Logged-out");
	}
	
	$scope.logout = function() {
		$ionicHistory.nextViewOptions({
			disableAnimate: true,
			disableBack: true
		});
		Parse.User.logOut();
		$timeout(function () {
        $ionicLoading.hide();
        $ionicHistory.clearCache();
        $ionicHistory.clearHistory();
        $ionicHistory.nextViewOptions({ disableBack: true, historyRoot: true });
        $rootScope.showMenuIcon = false;
		$state.go("app.login", {cache: false});
        }, 30);
	}
})

//Dashboard Controller
.controller('DashboardCtrl', function($scope, $stateParams, $timeout, ionicMaterialInk, ionicMaterialMotion) {
	$timeout(function() {
		ionicMaterialMotion.blinds({
			selector: '.animate-blinds .item'
		});
	}, 200);
	ionicMaterialInk.displayEffect()
})

//OrderController
.controller('OrderCtrl', function($scope, $stateParams, $timeout, ionicMaterialInk, ionicMaterialMotion) {
	google.maps.event.addDomListener(window, 'load', function() {
		var myLatlng = new google.maps.LatLng(37.3000, -120.4833);
		var mapOptions = {
			center: myLatlng,
			zoom: 16,
			mapTypeId: google.maps.MapTypeId.ROADMAP
		};
		var map = new google.maps.Map(document.getElementById("map"), mapOptions);
		navigator.geolocation.getCurrentPosition(function(pos) {
			map.setCenter(new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
			var myLocation = new google.maps.Marker({
				position: new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude),
				map: map,
				title: "My Location"
			});
		});
		$scope.map = map;
	});
	$timeout(function() {
		ionicMaterialMotion.fadeSlideIn({
			selector: '.animate-fade-slide-in .item'
		});
	}, 200);
	ionicMaterialInk.displayEffect()
})