/* global angular, document, window */
angular.module('starter.controllers', [])

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
		return Parse.User.current().id;
	}

})

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
.controller('LoginCtrl', function($scope, $stateParams, $ionicPopup, $location, $state, $ionicHistory, ionicMaterialInk, $rootScope, CurrentUser, Users, DialogBox) {
	
	
    $rootScope.showMenuIcon = false; //show hamburger icon

	$scope.data = {};
	$scope.signup = function() {

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
                    DialogBox.showDialog('alert', 'Successful', 'Welcome to bubbl.io!');
                    
                    //go to login window
                    $state.go("app.login", {cache: false});
                }, error: function(user, error) {
					DialogBox.showAlert('alert', 'Error', error.message);
                }
            });
	});
	}
	
	$scope.login = function() {

		Parse.User.logIn($scope.data.username, $scope.data.password, {
			success: function(user) {
				//login successful
				$ionicHistory.nextViewOptions({
					disableAnimate: true,
					disableBack: true
				});
				    
     			$rootScope.showMenuIcon = true; //show hamburger icon
				$state.go("app.dashboard", {cache: false}); 
				
			},
			error: function(user, error) {
				DialogBox.showDialog('alert', 'Error', error.message); 
			}
		});
	}
	
	$scope.loginFB = function() {
		
    	$rootScope.showMenuIcon = true; //show hamburger icon
		

		Parse.FacebookUtils.logIn(null, {
			success: function(user) {
				if (!user.existed()) {
						FB.api('/me', {fields: ['last_name', 'first_name', 'email']}, function(response) {
							var currentUser = Parse.User.current();
					        currentUser.set("firstname", response.first_name);
					        currentUser.set("lastname", response.last_name);
					        currentUser.set("email", response.email);
					        currentUser.save();
					        DialogBox.showDialog('alert', 'Successful', 'Welcome to bubbl.io!');
						});
				}
					$ionicHistory.nextViewOptions({
						disableAnimate: true,
						disableBack: true
					});
					
					$scope.firstName = CurrentUser.getCurrentFirstName();
		$scope.lastName = CurrentUser.getCurrentLastName();
		$scope.email = CurrentUser.getCurrentEmail();		
		
					$state.go("app.dashboard", {cache: false});
				},
			error: function(user, error) {
				DialogBox.showDialog('alert', 'Information', 'You have cancalled login or Facebook did not authorize');
			}
		});
	}
	
	
	$scope.forgot_password = function() {
	
    	$rootScope.showMenuIcon = true; //show hamburger icon

	if ($scope.data.email) {
		Parse.User.requestPasswordReset($scope.data.email, {
			success: function() {
				DialogBox.showDialog('alert', 'Successful', "Password change successful. Please check your e-mail."); 
			},
				error: function(error) {
				DialogBox.showDialog('alert', 'Error', error.message); 	
			}
		});
						
			} else {
					alert("Error: Please try again.");
			}
	
	ionicMaterialInk.displayEffect();
	
	}

})

//Menu Controller
.controller('MenuCtrl', function($scope, $ionicModal, $ionicLoading, $ionicHistory, $rootScope, $ionicPopover, $timeout, $location, $state, $ionicHistory, $ionicPopup, CurrentUser) {
		
	
	//check if there is a logged-in user
	if (Parse.User.current() != null) {
		$scope.showMenuIcon = true;
		$scope.toggleDrag = true;
		$scope.firstName = CurrentUser.getCurrentFirstName();
		$scope.lastName = CurrentUser.getCurrentLastName();
		$scope.email = CurrentUser.getCurrentEmail();		
	} else {
		Parse.User.logOut();
		//$rootScope.showMenuIcon = false;
		$scope.toggleDrag = false;
		console.log("Logged-out");
	}
	
	$scope.logout = function() {
		
		$ionicHistory.nextViewOptions({
			disableAnimate: true,
			disableBack: true
		});
		Parse.User.logOut();
		$rootScope.showMenuIcon = false;
		$state.go("app.login", {cache: false});
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
}).controller('InkCtrl', function($scope, $stateParams, ionicMaterialInk) {
	ionicMaterialInk.displayEffect();
}).controller('ComponentsCtrl', function($scope, $stateParams, ionicMaterialInk) {
	ionicMaterialInk.displayEffect();
	// Toggle Code Wrapper
	var code = document.getElementsByClassName('code-wrapper');
	for (var i = 0; i < code.length; i++) {
		code[i].addEventListener('click', function() {
			this.classList.toggle('active');
		});
	}
}).controller('ListsCtrl', function($scope, $stateParams, ionicMaterialMotion) {
	var reset = function() {
			var inClass = document.querySelectorAll('.in');
			for (var i = 0; i < inClass.length; i++) {
				inClass[i].classList.remove('in');
				inClass[i].removeAttribute('style');
			}
			var done = document.querySelectorAll('.done');
			for (var j = 0; j < done.length; j++) {
				done[j].classList.remove('done');
				done[j].removeAttribute('style');
			}
			var ionList = document.getElementsByTagName('ion-list');
			for (var k = 0; k < ionList.length; k++) {
				var toRemove = ionList[k].className;
				if (/animate-/.test(toRemove)) {
					ionList[k].className = ionList[k].className.replace(/(?:^|\s)animate-\S*(?:$|\s)/, '');
				}
			}
		};
	$scope.ripple = function() {
		reset();
		document.getElementsByTagName('ion-list')[0].className += ' animate-ripple';
		setTimeout(function() {
			ionicMaterialMotion.ripple();
		}, 500);
	};
	$scope.fadeSlideInRight = function() {
		reset();
		document.getElementsByTagName('ion-list')[0].className += ' animate-fade-slide-in-right';
		setTimeout(function() {
			ionicMaterialMotion.fadeSlideInRight();
		}, 500);
	};
	$scope.fadeSlideIn = function() {
		reset();
		document.getElementsByTagName('ion-list')[0].className += ' animate-fade-slide-in';
		setTimeout(function() {
			ionicMaterialMotion.fadeSlideIn();
		}, 500);
	};
	$scope.blinds = function() {
		reset();
		document.getElementsByTagName('ion-list')[0].className += ' animate-blinds';
		setTimeout(function() {
			ionicMaterialMotion.blinds();
		}, 500);
	};
	$scope.blinds();
})
