import base64
import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.shortcuts import render
from django.http import JsonResponse
from .models import School
from django.views.decorators.csrf import csrf_exempt

def portal(request):
    return render(request, 'portal.html')


def parent(request):
    return render(request, 'parent.html')

def schooladmin(request):
    return render(request, 'schooladmin.html')

def superadmin(request):
    return render(request, 'superadmin.html')

def fee_structure_manager(request):
    return render(request, 'fee-structure-manager.html')

def school_list(request):
    schools = School.objects.all().values('id', 'name')
    return JsonResponse(list(schools), safe=False)

def api_schools(request):
    schools = list(School.objects.values(
        'id', 'name', 'location', 'level', 'paybill'
    ))
    # JS expects string ids and camelCase-ish keys where it uses adminUsername etc.
    for s in schools:
        s['id'] = str(s['id'])
    return JsonResponse(schools, safe=False)


def _normalize_mpesa_phone(raw_phone):
    """Normalize phone number to 254XXXXXXXXX format (Safaricom format)."""
    if not raw_phone:
        return None
    digits = ''.join(ch for ch in raw_phone if ch.isdigit())
    if len(digits) == 9 and digits[0] in {'7', '1'}:
        return '254' + digits
    if len(digits) == 12 and digits.startswith('254'):
        return digits
    return None


def _fetch_mpesa_oauth_token():
    """Fetch OAuth2 token from Safaricom Daraja API."""
    key = settings.DARAJA_CONSUMER_KEY
    secret = settings.DARAJA_CONSUMER_SECRET
    if not key or not secret:
        raise ValueError('Daraja consumer key/secret are required')

    auth_header = base64.b64encode(f"{key}:{secret}".encode()).decode()
    url = f"{settings.DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials"
    request = Request(url, headers={
        'Authorization': f'Basic {auth_header}',
        'Accept': 'application/json',
    })

    try:
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data.get('access_token')
    except (HTTPError, URLError) as e:
        raise ValueError(f'Failed to acquire Daraja token: {str(e)}')


def _build_stk_password(shortcode, passkey, timestamp):
    """Build M-Pesa STK Push password."""
    payload = f"{shortcode}{passkey}{timestamp}".encode('utf-8')
    return base64.b64encode(payload).decode('utf-8')


@csrf_exempt
def api_mpesa_stk_push(request):
    """Initiate M-Pesa STK Push from Safaricom Daraja API."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        payload = json.loads(request.body)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid JSON payload'}, status=400)

    phone = _normalize_mpesa_phone(payload.get('phone') or '')
    amount = payload.get('amount')
    paybill = payload.get('paybill') or settings.DARAJA_PAYBILL
    account_reference = payload.get('accountReference') or payload.get('studentId') or 'FeePayment'
    transaction_desc = payload.get('transactionDesc') or 'School fee payment'

    if not phone:
        return JsonResponse({'error': 'A valid Kenyan phone number is required'}, status=400)
    if not paybill:
        return JsonResponse({'error': 'A Daraja paybill or shortcode is required'}, status=400)
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return JsonResponse({'error': 'A valid amount is required'}, status=400)
    if amount <= 0:
        return JsonResponse({'error': 'Amount must be greater than 0'}, status=400)

    shortcode = paybill
    passkey = settings.DARAJA_PASSKEY
    if not passkey:
        return JsonResponse({'error': 'Daraja passkey is not configured'}, status=500)

    timestamp = time.strftime('%Y%m%d%H%M%S', time.gmtime())
    password = _build_stk_password(shortcode, passkey, timestamp)
    callback_url = settings.DARAJA_STK_CALLBACK_URL

    try:
        token = _fetch_mpesa_oauth_token()
    except (ValueError, HTTPError, URLError) as exc:
        return JsonResponse({'error': f'Unable to acquire Daraja token: {str(exc)}'}, status=500)

    if not token:
        return JsonResponse({'error': 'Unable to retrieve Daraja access token'}, status=500)

    stk_request = {
        'BusinessShortCode': shortcode,
        'Password': password,
        'Timestamp': timestamp,
        'TransactionType': 'CustomerPayBillOnline',
        'Amount': int(amount),
        'PartyA': phone,
        'PartyB': shortcode,
        'PhoneNumber': phone,
        'CallBackURL': callback_url,
        'AccountReference': account_reference,
        'TransactionDesc': transaction_desc,
    }

    try:
        url = f"{settings.DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest"
        request = Request(url, data=json.dumps(stk_request).encode('utf-8'), headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        })
        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
    except HTTPError as exc:
        try:
            result = json.loads(exc.read().decode('utf-8'))
        except Exception:
            result = {'error': str(exc)}
        return JsonResponse(result, status=exc.code if exc.code >= 400 else 500)
    except URLError as exc:
        return JsonResponse({'error': f'M-Pesa request failed: {str(exc)}'}, status=500)

    if result.get('ResponseCode') not in {'0', 0}:
        return JsonResponse({'success': False, 'message': result.get('errorMessage') or result.get('ResponseDescription') or 'STK Push request failed'}, status=400)

    return JsonResponse({
        'success': True,
        'checkoutRequestId': result.get('CheckoutRequestID'),
        'merchantRequestId': result.get('MerchantRequestID'),
        'responseDescription': result.get('ResponseDescription'),
    })


@csrf_exempt
def api_mpesa_callback(request):
    """Handle M-Pesa STK Push callback from Safaricom."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    if settings.MPESA_CALLBACK_SECRET:
        secret = request.headers.get('X-MPESA-SECRET') or request.GET.get('secret')
        if secret != settings.MPESA_CALLBACK_SECRET:
            return JsonResponse({'error': 'Invalid callback secret'}, status=403)

    try:
        body = json.loads(request.body)
    except (ValueError, TypeError):
        body = {}

    return JsonResponse({'status': 'received'})

@csrf_exempt
def api_school_create(request):
    """Create a new school record."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'Invalid JSON payload'}, status=400)

    required_fields = ['name', 'location', 'level', 'paybill', 'adminUsername', 'adminPassword']
    for field in required_fields:
        if not data.get(field):
            return JsonResponse({'error': f'{field} is required'}, status=400)

    school = School.objects.create(
        name=data.get('name'),
        location=data.get('location'),
        level=data.get('level'),
        paybill=data.get('paybill'),
        admin_username=data.get('adminUsername'),
        admin_password=data.get('adminPassword'),
    )
    return JsonResponse({'id': str(school.id), 'name': school.name}, status=201)