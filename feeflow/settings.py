import os
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/6.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = 'django-insecure-f(0y5wve29+va*m^9b_a=ef%pt6$du=s86m(plsuxmwb5o_sus'

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

ALLOWED_HOSTS = [
    "fee-flow-psi.vercel.app",
    ".vercel.app",  # covers preview deployment URLs too, e.g. fee-flow-git-main-....vercel.app
    "127.0.0.1",
    "localhost",
]


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'myapp',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'feeflow.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'template'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'feeflow.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.0/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


# Password validation
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.0/howto/static-files/

STATIC_URL = 'static/'
STATICFILES_DIRS = [
    BASE_DIR / "static",
]

DARAJA_ENV = os.environ.get("DARAJA_ENV", "sandbox")  # sandbox | production
DARAJA_BASE_URL = (
    "https://sandbox.safaricom.co.ke"
    if DARAJA_ENV == "sandbox"
    else "https://api.safaricom.co.ke"
)
MPESA_CALLBACK_BASE_URL = os.environ.get(
    "MPESA_CALLBACK_BASE_URL", "https://yourdomain.example.com"
)
MPESA_ALLOWED_CALLBACK_IPS = [
    ip.strip() for ip in os.environ.get("MPESA_ALLOWED_CALLBACK_IPS", "").split(",") if ip.strip()
]
MPESA_CALLBACK_SECRET = os.environ.get("MPESA_CALLBACK_SECRET", "dev-callback-secret")

STK_PENDING_TIMEOUT_MINUTES = 20

# Safaricom Daraja credentials for M-Pesa STK Push
DARAJA_CONSUMER_KEY = os.environ.get("dqExNI2fGGQppnGcqokyGSA459dgzYW7PXrMuwc4NgAwMoym", "")
DARAJA_CONSUMER_SECRET = os.environ.get("Jb7YGJZl4Ym6zVMicgGVpqMnj1YGn5il94x7gaSwnSblRLcB36qGHl10J49SSRss", "")
DARAJA_PASSKEY = os.environ.get("DARAJA_PASSKEY", "")
DARAJA_PAYBILL = os.environ.get("DARAJA_PAYBILL", "")
DARAJA_SHORTCODE = os.environ.get("DARAJA_SHORTCODE", DARAJA_PAYBILL)
DARAJA_CALLBACK_BASE_URL = os.environ.get("DARAJA_CALLBACK_BASE_URL", MPESA_CALLBACK_BASE_URL)
DARAJA_STK_CALLBACK_PATH = os.environ.get("DARAJA_STK_CALLBACK_PATH", "/api/mpesa/callback/")
DARAJA_STK_CALLBACK_URL = f"{MPESA_CALLBACK_BASE_URL.rstrip('/')}{DARAJA_STK_CALLBACK_PATH}"